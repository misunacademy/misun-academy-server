/**
 * Terminal payment-record retention.
 *
 * Failed/cancelled gateway attempts are useful for a short audit window and
 * for support, but they are never shown to learners and must not accumulate
 * forever. This job archives them once they are older than the retention
 * window (default 90 days, configurable through
 * `PAYMENT_ARTIFACT_RETENTION_DAYS`).
 *
 * Only terminal rows are eligible:
 *   - payments in `failed` / `cancel`;
 *   - payment-attempt history in `failed` / `cancel`;
 *   - enrollments in `payment-failed` / `expired`;
 *   - bootcamp purchases in `rejected` and failed/superseded bootcamp attempts.
 *
 * Pending, review, risk, refunded and successful rows are never touched.
 */

import { EnrollmentStatus, Status } from '../../types/common.js';
import type { Model } from 'mongoose';
import { PaymentModel } from './payment.model.js';
import { PaymentAttemptModel } from './paymentAttempt.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { BootcampPurchaseModel } from '../Bootcamp/bootcampPurchase.model.js';
import { BootcampPurchaseStatus } from '../Bootcamp/bootcampCatalog.interface.js';
import {
    BootcampPaymentAttemptModel,
    BootcampPaymentAttemptStatus,
} from '../Bootcamp/bootcampPaymentAttempt.model.js';
import config from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { recordAudit } from '../../models/auditLog.model.js';

export interface PurgeTerminalRecordsOptions {
    olderThanDays?: number;
    limit?: number;
}

export interface PurgeTerminalRecordsSummary {
    payments: number;
    paymentAttempts: number;
    enrollments: number;
    bootcampPurchases: number;
    bootcampPaymentAttempts: number;
}

const DEFAULT_RETENTION_DAYS = 90;
const MAX_BATCH_SIZE = 500;

const resolveRetentionDays = (override?: number): number => {
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
        return override;
    }
    const fromEnv = Number(config.PAYMENT_ARTIFACT_RETENTION_DAYS);
    return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_RETENTION_DAYS;
};

const resolveLimit = (override?: number): number => {
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
        return Math.min(Math.floor(override), MAX_BATCH_SIZE);
    }
    return MAX_BATCH_SIZE;
};

const archiveBatch = async (
    model: Model<any>,
    filter: Record<string, unknown>,
    limit: number,
    targetType: string
): Promise<number> => {
    const rows = (await model.find(filter as never).select('_id gatewayResponse').lean()) as any[];
    if (rows.length === 0) return 0;

    const ids = rows.map((row: any) => row._id);

    // Redact PII from gatewayResponse before archiving
    await model.updateMany(
        { _id: { $in: ids } },
        {
            $unset: {
                'gatewayResponse.cardNumber': '',
                'gatewayResponse.cvv': '',
                'gatewayResponse.cardCvv': '',
                'gatewayResponse.securityCode': '',
            },
        }
    );

    const result = await model.updateMany(
        { _id: { $in: ids }, archivedAt: { $exists: false } },
        { $set: { archivedAt: new Date() } }
    );

    // Write audit log for each archived record
    for (const row of rows) {
        await recordAudit({
            actor: 'system',
            action: `${targetType}.archive`,
            targetType,
            targetId: row._id.toString(),
            metadata: { archivedAt: new Date(), reason: 'retention_policy' },
        });
    }

    return result.modifiedCount ?? rows.length;
};

export const purgeTerminalPaymentRecords = async (
    options: PurgeTerminalRecordsOptions = {}
): Promise<PurgeTerminalRecordsSummary> => {
    const olderThanDays = resolveRetentionDays(options.olderThanDays);
    const limit = resolveLimit(options.limit);
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const [payments, paymentAttempts, enrollments, bootcampPurchases, bootcampPaymentAttempts] =
        await Promise.all([
            archiveBatch(
                PaymentModel,
                {
                    status: { $in: [Status.Failed, Status.Cancel] },
                    updatedAt: { $lte: cutoff },
                    archivedAt: { $exists: false },
                },
                limit,
                'payment'
            ),
            archiveBatch(
                PaymentAttemptModel,
                {
                    status: { $in: [Status.Failed, Status.Cancel] },
                    updatedAt: { $lte: cutoff },
                    archivedAt: { $exists: false },
                },
                limit,
                'payment-attempt'
            ),
            archiveBatch(
                EnrollmentModel,
                {
                    status: {
                        $in: [EnrollmentStatus.PaymentFailed, EnrollmentStatus.Expired],
                    },
                    updatedAt: { $lte: cutoff },
                    archivedAt: { $exists: false },
                    // Never archive an enrollment that already holds an
                    // enrollmentId — those are paid enrollments that must be
                    // retained for audit/certificates/posters.
                    enrollmentId: { $exists: false },
                },
                limit,
                'enrollment'
            ),
            archiveBatch(
                BootcampPurchaseModel,
                {
                    status: BootcampPurchaseStatus.Rejected,
                    updatedAt: { $lte: cutoff },
                    archivedAt: { $exists: false },
                },
                limit,
                'bootcamp-purchase'
            ),
            archiveBatch(
                BootcampPaymentAttemptModel,
                {
                    status: {
                        $in: [
                            BootcampPaymentAttemptStatus.Failed,
                            BootcampPaymentAttemptStatus.Superseded,
                        ],
                    },
                    updatedAt: { $lte: cutoff },
                    archivedAt: { $exists: false },
                },
                limit,
                'bootcamp-payment-attempt'
            ),
        ]);

    const summary: PurgeTerminalRecordsSummary = {
        payments,
        paymentAttempts,
        enrollments,
        bootcampPurchases,
        bootcampPaymentAttempts,
    };

    const deletedTotal =
        payments + paymentAttempts + enrollments + bootcampPurchases + bootcampPaymentAttempts;

    if (deletedTotal > 0) {
        logger.info(
            {
                event: 'payment.terminal_records_purged',
                olderThanDays,
                ...summary,
            },
            'Purged terminal payment records past retention'
        );
    }

    return summary;
};
