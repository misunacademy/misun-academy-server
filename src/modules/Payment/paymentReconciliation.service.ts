/**
 * Payment reconciliation job.
 *
 * A gateway payment can be captured without our app ever hearing about it: the
 * learner closes the tab after paying, the IPN never arrives, or the redirect
 * lands while the server is restarting. Without reconciliation those rows sit
 * on `pending` forever and the learner has paid for a course they cannot open.
 *
 * This job asks SSLCommerz for the authoritative state of every stale pending
 * transaction (including sessions superseded by a retry) and:
 *   - settles it through the normal finalize path when the gateway says PAID,
 *   - marks it failed when the gateway says the attempt is dead,
 *   - leaves it alone when the gateway is unreachable or still processing.
 *
 * The gateway lookup and the finalize call are injectable so the job can be
 * tested without network access.
 */

import { Status, EnrollmentStatus } from '../../types/common.js';
import { PaymentModel } from './payment.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { PaymentService, querySSLCommerzTransaction } from './payment.service.js';
import config from '../../config/env.js';
import { logger } from '../../config/logger.js';

export type GatewayTransactionSnapshot = {
    status?: string;
    tran_id?: string;
    amount?: string | number;
    currency?: string;
    val_id?: string;
} | null;

export interface ReconcilePaymentsOptions {
    olderThanMinutes?: number;
    limit?: number;
    queryTransaction?: (transactionId: string) => Promise<GatewayTransactionSnapshot>;
    finalizePayment?: (transactionId: string, valId: string) => Promise<unknown>;
}

export interface ReconcilePaymentsSummary {
    checked: number;
    settled: number;
    failed: number;
    stillPending: number;
    skipped: number;
}

const DEFAULT_RECONCILE_AFTER_MINUTES = 20;
const MAX_BATCH_SIZE = 200;

const PAID_GATEWAY_STATUSES = new Set(['VALID', 'VALIDATED']);
const DEAD_GATEWAY_STATUSES = new Set([
    'FAILED',
    'FAIL',
    'CANCELLED',
    'CANCELED',
    'CANCEL',
    'EXPIRED',
    'INVALID_TRANSACTION',
]);

const normalizeGatewayStatus = (value: unknown): string =>
    String(value ?? '').trim().toUpperCase();

const resolveReconcileAge = (override?: number): number => {
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
        return override;
    }
    const fromEnv = Number(config.PAYMENT_RECONCILE_AFTER_MINUTES);
    return Number.isFinite(fromEnv) && fromEnv >= 0
        ? fromEnv
        : DEFAULT_RECONCILE_AFTER_MINUTES;
};

/**
 * Candidate gateway transaction ids for a payment row: the live one first, then
 * any session it superseded (the learner may have completed an older session).
 */
const getCandidateTransactionIds = (payment: {
    transactionId?: string;
    gatewayResponse?: any;
}): string[] => {
    const superseded = Array.isArray(payment.gatewayResponse?.supersededTranIds)
        ? payment.gatewayResponse.supersededTranIds
        : [];

    return Array.from(
        new Set(
            [payment.transactionId, ...superseded].filter(
                (value): value is string => typeof value === 'string' && value.length > 0
            )
        )
    );
};

const markPaymentFailed = async (
    paymentId: unknown,
    gatewayStatus: string,
    now: Date
): Promise<boolean> => {
    const updated = await PaymentModel.findOneAndUpdate(
        { _id: paymentId, status: Status.Pending },
        {
            $set: {
                status: Status.Failed,
                'gatewayResponse.reconciledAt': now,
                'gatewayResponse.reconciledStatus': gatewayStatus,
            },
        },
        { new: true }
    );

    return Boolean(updated);
};

export const reconcilePendingPayments = async (
    options: ReconcilePaymentsOptions = {}
): Promise<ReconcilePaymentsSummary> => {
    const olderThanMinutes = resolveReconcileAge(options.olderThanMinutes);
    const limit = Math.min(options.limit ?? 50, MAX_BATCH_SIZE);
    const queryTransaction = options.queryTransaction ?? querySSLCommerzTransaction;
    const finalizePayment =
        options.finalizePayment ??
        ((transactionId: string, valId: string) =>
            PaymentService.finalizeSSLCommerzPayment(transactionId, valId));

    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const pendingPayments = await PaymentModel.find({
        status: Status.Pending,
        method: 'SSLCommerz',
        $or: [
            { expiresAt: { $lte: cutoff } },
            { updatedAt: { $lte: cutoff } },
        ],
    })
        .sort({ updatedAt: 1 })
        .limit(limit)
        .lean();

    const summary: ReconcilePaymentsSummary = {
        checked: 0,
        settled: 0,
        failed: 0,
        stillPending: 0,
        skipped: 0,
    };

    for (const payment of pendingPayments) {
        summary.checked += 1;

        const candidateIds = getCandidateTransactionIds(payment);
        if (candidateIds.length === 0) {
            summary.skipped += 1;
            continue;
        }

        let settled = false;
        let unreachable = false;
        let sawProcessing = false;
        let mismatched = false;
        let deadAttempts = 0;
        let lastGatewayStatus = 'UNKNOWN';

        for (const transactionId of candidateIds) {
            let snapshot: GatewayTransactionSnapshot;

            try {
                snapshot = await queryTransaction(transactionId);
            } catch (error) {
                logger.error(
                    { err: error, event: 'payment.reconcile_query_failed', transactionId },
                    'Gateway transaction lookup failed during reconciliation'
                );
                unreachable = true;
                break;
            }

            if (!snapshot) {
                // Transport failure / timeout: never guess. Next run retries.
                unreachable = true;
                break;
            }

            const gatewayStatus = normalizeGatewayStatus(snapshot.status);
            lastGatewayStatus = gatewayStatus || 'UNKNOWN';

            if (PAID_GATEWAY_STATUSES.has(gatewayStatus)) {
                const amountMatches =
                    Number(snapshot.amount) === Number(payment.amount);
                const currencyMatches =
                    normalizeGatewayStatus(snapshot.currency) ===
                    normalizeGatewayStatus(payment.currency || 'BDT');

                if (!amountMatches || !currencyMatches) {
                    // Money arrived but does not match what we asked for — a
                    // human must decide. Never auto-activate on a mismatch.
                    logger.error(
                        {
                            event: 'payment.reconcile_mismatch',
                            transactionId,
                            expected: {
                                amount: payment.amount,
                                currency: payment.currency || 'BDT',
                            },
                            received: {
                                amount: snapshot.amount,
                                currency: snapshot.currency,
                            },
                        },
                        'Reconciliation found a paid transaction with mismatched amount/currency'
                    );
                    mismatched = true;
                    break;
                }

                if (!snapshot.val_id) {
                    logger.warn(
                        { event: 'payment.reconcile_missing_val_id', transactionId },
                        'Paid transaction has no val_id; leaving it for the next run'
                    );
                    sawProcessing = true;
                    continue;
                }

                await finalizePayment(transactionId, snapshot.val_id);
                summary.settled += 1;
                settled = true;

                logger.info(
                    {
                        event: 'payment.reconciled_settled',
                        transactionId,
                        enrollmentId: payment.enrollmentId,
                        amount: payment.amount,
                        currency: payment.currency,
                    },
                    'Reconciliation settled a captured payment'
                );
                break;
            }

            if (DEAD_GATEWAY_STATUSES.has(gatewayStatus)) {
                deadAttempts += 1;
                continue;
            }

            // PENDING / PROCESSING / anything unrecognised: try again later.
            sawProcessing = true;
        }

        if (settled) {
            continue;
        }

        if (mismatched) {
            summary.skipped += 1;
            continue;
        }

        if (unreachable || sawProcessing) {
            summary.stillPending += 1;
            continue;
        }

        if (deadAttempts === candidateIds.length) {
            const now = new Date();
            const marked = await markPaymentFailed(payment._id, lastGatewayStatus, now);

            if (!marked) {
                // Someone settled or failed it while we were checking.
                summary.skipped += 1;
                continue;
            }

            await EnrollmentModel.updateOne(
                {
                    enrollmentId: payment.enrollmentId,
                    status: {
                        $in: [EnrollmentStatus.Pending, EnrollmentStatus.PaymentPending],
                    },
                },
                {
                    $set: {
                        status: EnrollmentStatus.PaymentFailed,
                        statusChangeReason:
                            'Gateway reported no successful payment (reconciliation)',
                    },
                }
            );

            summary.failed += 1;
            logger.info(
                {
                    event: 'payment.reconciled_failed',
                    transactionId: payment.transactionId,
                    enrollmentId: payment.enrollmentId,
                    gatewayStatus: lastGatewayStatus,
                },
                'Reconciliation marked a dead gateway attempt as failed'
            );
            continue;
        }

        summary.stillPending += 1;
    }

    return summary;
};
