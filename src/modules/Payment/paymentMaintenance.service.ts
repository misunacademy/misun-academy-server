/**
 * Payment maintenance orchestrator.
 *
 * Runs in this order on purpose: settle captured-but-unrecorded payments first,
 * then expire what is genuinely abandoned. Expiring before reconciling would
 * fail enrollments whose money is actually sitting at the gateway.
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

export interface PaymentMaintenanceResult {
    reconciliation: ReconcilePaymentsSummary;
    expiry: ExpireAbandonedSummary;
}

export const runPaymentMaintenance = async (options?: {
    reconciliation?: ReconcilePaymentsOptions;
    expiry?: ExpireAbandonedOptions;
}): Promise<PaymentMaintenanceResult> => {
    const startedAt = Date.now();

    const reconciliation = await reconcilePendingPayments(options?.reconciliation);
    const expiry = await expireAbandonedEnrollments(options?.expiry);

    logger.info(
        {
            event: 'payment.maintenance_run',
            durationMs: Date.now() - startedAt,
            reconciliation,
            expiry,
        },
        'Payment maintenance run completed'
    );

    return { reconciliation, expiry };
};
