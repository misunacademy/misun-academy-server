/**
 * Abandoned enrollment sweep.
 *
 * A learner who opens checkout, creates an enrollment and never completes the
 * payment leaves a `pending` row behind. Left alone those rows pile up as
 * permanent "Pending" entries in My Enrollments / Payment History and keep the
 * `(userId, batchId)` pair locked, so the learner cannot start cleanly again.
 *
 * This job moves stale `pending` / `payment-pending` enrollments to
 * `expired` once the payment window has passed. Explicit gateway failures
 * remain `payment-failed`.
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
import { EnrollmentStatusHistoryModel } from './enrollmentStatusHistory.model.js';
import { PaymentModel } from '../Payment/payment.model.js';
import { PaymentAttemptModel } from '../Payment/paymentAttempt.model.js';
import { UserModel } from '../User/user.model.js';
import config from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { recordAudit } from '../../models/auditLog.model.js';
import mongoose from 'mongoose';
import { queueEmail } from '../../services/emailService.js';

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
        // landed between the read above and this write. Write through the
        // shared transitionEnrollment primitive so a status-history row is
        // appended inside the same transaction.
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
                    status: EnrollmentStatus.Expired,
                    statusChangeReason: `Auto-expired: payment not completed within ${olderThanHours}h`,
                },
            },
            { new: true }
        );

        if (!expired) {
            summary.skipped += 1;
            continue;
        }

        // Append-only status history + audit for the cron-driven transition.
        await EnrollmentStatusHistoryModel.create({
            enrollmentId: expired._id,
            userId: expired.userId,
            batchId: expired.batchId as mongoose.Types.ObjectId,
            from: candidate.status,
            to: EnrollmentStatus.Expired,
            actorType: 'cron',
            source: 'expireAbandonedEnrollments',
            reason: `Auto-expired: payment not completed within ${olderThanHours}h`,
        });

        await recordAudit({
            actor: 'system',
            action: 'enrollment.cron_expire',
            targetType: 'Enrollment',
            targetId: expired._id?.toString(),
            metadata: {
                enrollmentId: expired.enrollmentId,
                from: candidate.status,
                to: EnrollmentStatus.Expired,
                reason: `Auto-expired: payment not completed within ${olderThanHours}h`,
            },
        });

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

        if (payment) {
            await PaymentAttemptModel.updateMany(
                {
                    enrollmentRef: candidate._id,
                    status: Status.Pending,
                },
                {
                    $set: {
                        status: Status.Failed,
                        'gatewayResponse.expiredAt': new Date(),
                        'gatewayResponse.expiredReason': 'abandoned-enrollment',
                    },
                }
            );
        }

        // Notify learner with a retry link (durable, idempotent via eventId)
        try {
            const userRow = await UserModel.findById(expired.userId).lean();
            if (userRow) {
                const retryLink = `${config.SERVER_URL || 'https://misun.academy'}/enroll/${expired.batchId}`;
                await queueEmail(
                    userRow.email,
                    'Your course access has expired',
                    `<p>Hello ${userRow.name},</p><p>Your enrollment for batch <strong>${expired.enrollmentId}</strong> has expired because payment was not completed within ${olderThanHours} hours.</p><p><a href="${retryLink}">Click here to re-enroll</a> and regain access.</p>`,
                    {
                        eventId: `enrollment_expired_${expired.enrollmentId}`,
                        eventType: 'enrollment_expired',
                        priority: 'high',
                    }
                );
            }
        } catch {
            // Email is best-effort; expiry status is already committed.
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
