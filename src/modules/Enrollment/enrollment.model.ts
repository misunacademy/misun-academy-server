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
            // Uniqueness enforced by sparse index below (allows multiple null/missing during creation)
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
            default: Date.now,
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
    },
    {
        timestamps: true,
    }
);

// Indexes
enrollmentSchema.index({ enrollmentId: 1 }, { unique: true, sparse: true });
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
