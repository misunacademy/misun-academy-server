/**
 * Abandoned enrollment sweep.
 *
 * A learner who opens checkout, creates an enrollment and never completes the
 * payment leaves a `pending` row behind. Left alone those rows pile up as
 * permanent "Pending" entries in My Enrollments / Payment History and keep the
 * `(userId, batchId)` pair locked, so the learner cannot start cleanly again.
 *
 * This job moves stale `pending` / `payment-pending` enrollments to
 * `payment-failed` (a state the learner can retry from) once the payment
 * window has passed.
 *
 * Deliberate exclusions:
 *   - manual payments under admin review (`Status.Review`) are never expired —
 *     the learner has already sent money;
 *   - successful payments are never expired;
 *   - batch seat counters (`currentEnrollment`) are intentionally left as-is,
 *     per product decision — do not "fix" this without a counter audit.
 */

import { EnrollmentStatus, Status } from '../../types/common.js';
import { EnrollmentModel } from './enrollment.model.js';
import { PaymentModel } from '../Payment/payment.model.js';
import config from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface ExpireAbandonedOptions {
    olderThanHours?: number;
    limit?: number;
}

export interface ExpireAbandonedSummary {
    checked: number;
    expired: number;
    skipped: number;
}

const DEFAULT_EXPIRY_HOURS = 48;
const MAX_BATCH_SIZE = 200;

const resolveExpiryHours = (override?: number): number => {
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
        return override;
    }
    const fromEnv = Number(config.ENROLLMENT_EXPIRY_HOURS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_EXPIRY_HOURS;
};

export const expireAbandonedEnrollments = async (
    options: ExpireAbandonedOptions = {}
): Promise<ExpireAbandonedSummary> => {
    const olderThanHours = resolveExpiryHours(options.olderThanHours);
    const limit = Math.min(options.limit ?? 100, MAX_BATCH_SIZE);
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

    const candidates = await EnrollmentModel.find({
        status: {
            $in: [EnrollmentStatus.Pending, EnrollmentStatus.PaymentPending],
        },
        updatedAt: { $lte: cutoff },
    })
        .select('_id enrollmentId status')
        .sort({ updatedAt: 1 })
        .limit(limit)
        .lean();

    const summary: ExpireAbandonedSummary = {
        checked: 0,
        expired: 0,
        skipped: 0,
    };

    for (const candidate of candidates) {
        summary.checked += 1;

        const payment = candidate.enrollmentId
            ? await PaymentModel.findOne({ enrollmentId: candidate.enrollmentId })
                  .select('status')
                  .lean()
            : null;

        // Money may already be with us (manual review) or fully settled.
        if (
            payment &&
            (payment.status === Status.Review || payment.status === Status.Success)
        ) {
            summary.skipped += 1;
            continue;
        }

        // Conditional update re-checks the state: a payment or retry may have
        // landed between the read above and this write.
        const expired = await EnrollmentModel.findOneAndUpdate(
            {
                _id: candidate._id,
                status: {
                    $in: [EnrollmentStatus.Pending, EnrollmentStatus.PaymentPending],
                },
                updatedAt: { $lte: cutoff },
            },
            {
                $set: {
                    status: EnrollmentStatus.PaymentFailed,
                    statusChangeReason: `Auto-expired: payment not completed within ${olderThanHours}h`,
                },
            },
            { new: true }
        );

        if (!expired) {
            summary.skipped += 1;
            continue;
        }

        if (payment && payment.status === Status.Pending) {
            await PaymentModel.updateOne(
                { enrollmentId: candidate.enrollmentId, status: Status.Pending },
                {
                    $set: {
                        status: Status.Failed,
                        'gatewayResponse.expiredAt': new Date(),
                        'gatewayResponse.expiredReason': 'abandoned-enrollment',
                    },
                }
            );
        }

        summary.expired += 1;
    }

    if (summary.expired > 0) {
        logger.info(
            {
                event: 'enrollment.abandoned_expired',
                olderThanHours,
                ...summary,
            },
            'Expired abandoned enrollments'
        );
    }

    return summary;
};
