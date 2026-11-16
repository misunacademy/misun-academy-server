import { Schema, model } from 'mongoose';
import { EnrollmentStatus } from '../../types/common.js';
import { IEnrollment } from './enrollment.interface.js';

const enrollmentSchema = new Schema<IEnrollment>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
            required: true,
        },
        enrollmentId: {
            type: String,
            // Uniqueness enforced by sparse index below (assigned only after verified payment)
        },
        paymentId: {
            type: Schema.Types.ObjectId,
            ref: 'Payment',
        },
        status: {
            type: String,
            enum: Object.values(EnrollmentStatus),
            default: EnrollmentStatus.Pending,
        },
        statusChangeReason: {
            type: String,
        },
        archivedAt: {
            type: Date,
        },
        accessType: {
            type: String,
            enum: ['standard', 'special'],
            default: 'standard',
        },
        enrolledAt: {
            type: Date,
            // Only set when the enrollment is activated after verified payment.
            // Unpaid PaymentPending rows must not have an enrolledAt.
        },
        completedAt: {
            type: Date,
        },
        certificateIssued: {
            type: Boolean,
            default: false,
        },
        certificateId: {
            type: String,
        },
        // Lifetime access - no expiry field needed
        // Access is only revoked if user/enrollment is suspended by admin
        deferUntil: {
            type: Date,
        },
        accessExtendedUntil: {
            type: Date,
        },
        transferredToBatchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
        },
        transferredFromBatchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
        },
        grantedViaPerk: {
            type: Boolean,
            default: false,
        },
        perkRuleId: {
            type: Schema.Types.ObjectId,
            ref: 'EnrollmentPerkRule',
        },
        perkSourceEnrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
// enrollmentId is unique only among documents that actually hold one.
enrollmentSchema.index({ enrollmentId: 1 }, { unique: true, partialFilterExpression: { enrollmentId: { $type: 'string' } } });
enrollmentSchema.index({ userId: 1, status: 1 });
enrollmentSchema.index({ batchId: 1, status: 1 });
// Only one non-terminal enrollment may exist for a learner/batch pair.
// Terminal payment records are retained for audit/support and must not block
// a later checkout attempt.
enrollmentSchema.index(
    { userId: 1, batchId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: {
                $in: [
                    EnrollmentStatus.Pending,
                    EnrollmentStatus.PaymentPending,
                    EnrollmentStatus.Active,
                    EnrollmentStatus.Completed,
                    EnrollmentStatus.Suspended,
                ],
            },
        },
    }
);

export const EnrollmentModel = model<IEnrollment>('Enrollment', enrollmentSchema);
