import { Schema, model, Types } from 'mongoose';
import { BootcampPurchaseStatus } from './bootcampCatalog.interface.js';

export interface IBootcampPurchaseStatusHistory {
    purchaseId: Types.ObjectId;
    userId: Types.ObjectId;
    bootcampId: Types.ObjectId;
    from: BootcampPurchaseStatus;
    to: BootcampPurchaseStatus;
    actorType: 'user' | 'admin' | 'system' | 'gateway' | 'cron';
    actorId?: Types.ObjectId;
    reason?: string;
    source?: string;
    paymentId?: Types.ObjectId;
    correlationId?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

const bootcampPurchaseStatusHistorySchema = new Schema<IBootcampPurchaseStatusHistory>(
    {
        purchaseId: {
            type: Schema.Types.ObjectId,
            ref: 'BootcampPurchase',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        bootcampId: {
            type: Schema.Types.ObjectId,
            ref: 'Bootcamp',
            required: true,
            index: true,
        },
        from: {
            type: String,
            enum: Object.values(BootcampPurchaseStatus),
            required: true,
        },
        to: {
            type: String,
            enum: Object.values(BootcampPurchaseStatus),
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

bootcampPurchaseStatusHistorySchema.index({ purchaseId: 1, createdAt: -1 });

export const BootcampPurchaseStatusHistoryModel = model<IBootcampPurchaseStatusHistory>(
    'BootcampPurchaseStatusHistory',
    bootcampPurchaseStatusHistorySchema
);
