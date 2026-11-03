import { BootcampPurchaseModel } from './bootcampPurchase.model.js';
import {
    BootcampPurchaseStatus,
} from './bootcampCatalog.interface.js';
import {
    BootcampPaymentAttemptModel,
    BootcampPaymentAttemptStatus,
} from './bootcampPaymentAttempt.model.js';
import config from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface ExpireBootcampPurchasesOptions {
    olderThanMinutes?: number;
    limit?: number;
}

export interface ExpireBootcampPurchasesSummary {
    checked: number;
    expired: number;
    skipped: number;
}

const DEFAULT_EXPIRY_MINUTES = 60;
const MAX_BATCH_SIZE = 200;

const resolveExpiryMinutes = (override?: number): number => {
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
        return override;
    }
    const fromEnv = Number(config.BOOTCAMP_PURCHASE_EXPIRY_MINUTES);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_EXPIRY_MINUTES;
};

export const expireAbandonedBootcampPurchases = async (
    options: ExpireBootcampPurchasesOptions = {}
): Promise<ExpireBootcampPurchasesSummary> => {
    const olderThanMinutes = resolveExpiryMinutes(options.olderThanMinutes);
    const limit = Math.min(options.limit ?? 100, MAX_BATCH_SIZE);
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const candidates = await BootcampPurchaseModel.find({
        status: BootcampPurchaseStatus.Pending,
        createdAt: { $lte: cutoff },
    })
        .select('_id transactionId')
        .sort({ createdAt: 1 })
        .limit(limit)
        .lean();

    const summary: ExpireBootcampPurchasesSummary = {
        checked: candidates.length,
        expired: 0,
        skipped: 0,
    };

    for (const candidate of candidates) {
        const expired = await BootcampPurchaseModel.findOneAndUpdate(
            {
                _id: candidate._id,
                status: BootcampPurchaseStatus.Pending,
                createdAt: { $lte: cutoff },
            },
            {
                $set: {
                    status: BootcampPurchaseStatus.Rejected,
                    'gatewayResponse.status': 'expired',
                    'gatewayResponse.expiredAt': new Date(),
                    'gatewayResponse.expiredReason': 'abandoned-bootcamp-purchase',
                },
            },
            { new: true }
        );

        if (!expired) {
            summary.skipped += 1;
            continue;
        }

        await BootcampPaymentAttemptModel.updateOne(
            {
                transactionId: candidate.transactionId,
                status: BootcampPaymentAttemptStatus.Pending,
            },
            {
                $set: {
                    status: BootcampPaymentAttemptStatus.Failed,
                    'gatewayResponse.status': 'expired',
                    'gatewayResponse.expiredAt': new Date(),
                },
            }
        );
        summary.expired += 1;
    }

    if (summary.expired > 0) {
        logger.info(
            { event: 'bootcamp.purchase_expired', olderThanMinutes, ...summary },
            'Expired abandoned bootcamp purchases'
        );
    }

    return summary;
};
