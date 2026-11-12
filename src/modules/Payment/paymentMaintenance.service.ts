/**
 * Payment maintenance orchestrator.
 *
 * Runs in this order on purpose: settle captured-but-unrecorded course payments
 * first, then expire genuinely abandoned course and bootcamp purchases.
 */

import {
    reconcilePendingPayments,
    type ReconcilePaymentsOptions,
    type ReconcilePaymentsSummary,
} from './paymentReconciliation.service.js';
import {
    expireAbandonedEnrollments,
    type ExpireAbandonedOptions,
    type ExpireAbandonedSummary,
} from '../Enrollment/enrollmentMaintenance.service.js';
import { logger } from '../../config/logger.js';
import {
    expireAbandonedBootcampPurchases,
    type ExpireBootcampPurchasesOptions,
    type ExpireBootcampPurchasesSummary,
} from '../Bootcamp/bootcampMaintenance.service.js';
import {
    purgeTerminalPaymentRecords,
    type PurgeTerminalRecordsOptions,
    type PurgeTerminalRecordsSummary,
} from './paymentCleanup.service.js';
import { PaymentModel } from './payment.model.js';
import { PaymentService } from './payment.service.js';

export interface PaymentMaintenanceResult {
    reconciliation: ReconcilePaymentsSummary;
    expiry: ExpireAbandonedSummary;
    bootcampExpiry: ExpireBootcampPurchasesSummary;
    purge: PurgeTerminalRecordsSummary;
}

export interface MarkExpiredSummary {
    checked: number;
    expired: number;
    skipped: number;
}

export const runPaymentMaintenance = async (options?: {
    reconciliation?: ReconcilePaymentsOptions;
    expiry?: ExpireAbandonedOptions;
    bootcampExpiry?: ExpireBootcampPurchasesOptions;
    purge?: PurgeTerminalRecordsOptions;
}): Promise<PaymentMaintenanceResult & { markExpired: MarkExpiredSummary }> => {
    const startedAt = Date.now();

    // 1. Reconcile stale Pending payments against the gateway first — settle
    // captured payments and mark dead attempts Failed. Idempotent.
    const reconciliation = await reconcilePendingPayments(options?.reconciliation);

    // 2. Mark any Pending payment still unpaid and past its expiresAt as
    //    Expired. Only payments reconcilePendingPayments could not settle
    //    (gateway unreachable / still processing) remain here.
    const cutoff = new Date(Date.now() - (Number(options?.reconciliation?.olderThanMinutes ?? 20) * 60 * 1000));
    const stillPending = await PaymentModel.find({
        status: 'pending',
        method: 'SSLCommerz',
        $or: [
            { expiresAt: { $lte: cutoff } },
            { updatedAt: { $lte: cutoff } },
        ],
    }).lean();

    const markExpired: MarkExpiredSummary = { checked: 0, expired: 0, skipped: 0 };
    for (const payment of stillPending) {
        markExpired.checked += 1;
        const marked = await PaymentService.markPaymentExpired(payment.transactionId);
        if (marked) {
            markExpired.expired += 1;
        } else {
            markExpired.skipped += 1;
        }
    }

    // 3. Expire old abandoned PaymentPending enrollments with no active payment.
    const expiry = await expireAbandonedEnrollments(options?.expiry);
    const bootcampExpiry = await expireAbandonedBootcampPurchases(options?.bootcampExpiry);
    // Delete last: rows expired by the steps above are fresh and stay inside
    // the retention window, so they are not purged on the same run.
    const purge = await purgeTerminalPaymentRecords(options?.purge);

    logger.info(
        {
            event: 'payment.maintenance_run',
            durationMs: Date.now() - startedAt,
            reconciliation,
            markExpired,
            expiry,
            bootcampExpiry,
            purge,
        },
        'Payment maintenance run completed'
    );

    return { reconciliation, markExpired, expiry, bootcampExpiry, purge };
};
