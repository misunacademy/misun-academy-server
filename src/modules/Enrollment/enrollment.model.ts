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
            unique: true, // Allow null/undefined values, but unique when present
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
    },
    {
        timestamps: true,
    }
);

// Indexes
enrollmentSchema.index({ userId: 1, status: 1 });
enrollmentSchema.index({ batchId: 1, status: 1 });
enrollmentSchema.index({ userId: 1, batchId: 1 }, { unique: true });

export const EnrollmentModel = model<IEnrollment>('Enrollment', enrollmentSchema);
