import { Schema, model, Types } from 'mongoose';
import { EnrollmentStatus } from '../../types/common.js';

export interface IEnrollmentStatusHistory {
    enrollmentId: Types.ObjectId;
    userId: Types.ObjectId;
    batchId: Types.ObjectId;
    from: EnrollmentStatus;
    to: EnrollmentStatus;
    actorType: 'user' | 'admin' | 'system' | 'gateway' | 'cron';
    actorId?: Types.ObjectId;
    reason?: string;
    source?: string;
    paymentId?: Types.ObjectId;
    correlationId?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

const enrollmentStatusHistorySchema = new Schema<IEnrollmentStatusHistory>(
    {
        enrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
            required: true,
            index: true,
        },
        from: {
            type: String,
            enum: Object.values(EnrollmentStatus),
            required: true,
        },
        to: {
            type: String,
            enum: Object.values(EnrollmentStatus),
            required: true,
        },
        actorType: {
            type: String,
            enum: ['user', 'admin', 'system', 'gateway', 'cron'],
            required: true,
        },
        actorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        reason: {
            type: String,
        },
        source: {
            type: String,
        },
        paymentId: {
            type: Schema.Types.ObjectId,
            ref: 'Payment',
        },
        correlationId: {
            type: String,
        },
    },
    { timestamps: true }
);

enrollmentStatusHistorySchema.index({ enrollmentId: 1, createdAt: -1 });

export const EnrollmentStatusHistoryModel = model<IEnrollmentStatusHistory>(
    'EnrollmentStatusHistory',
    enrollmentStatusHistorySchema
);
