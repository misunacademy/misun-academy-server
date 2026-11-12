import { Schema, model, Types } from 'mongoose';

export enum BootcampPaymentAttemptStatus {
    Pending = 'pending',
    Success = 'success',
    Failed = 'failed',
    Superseded = 'superseded',
}

export interface IBootcampPaymentAttempt {
    _id?: Types.ObjectId;
    purchase: Types.ObjectId;
    user: Types.ObjectId;
    bootcamp: Types.ObjectId;
    transactionId: string;
    amount: number;
    status: BootcampPaymentAttemptStatus;
    gatewayResponse?: Record<string, unknown>;
    archivedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const schema = new Schema<IBootcampPaymentAttempt>(
    {
        purchase: { type: Schema.Types.ObjectId, ref: 'BootcampPurchase', required: true, index: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        bootcamp: { type: Schema.Types.ObjectId, ref: 'Bootcamp', required: true, index: true },
        transactionId: { type: String, required: true, unique: true, trim: true },
        amount: { type: Number, required: true, min: 0 },
        status: { type: String, enum: Object.values(BootcampPaymentAttemptStatus), required: true, index: true },
        gatewayResponse: { type: Schema.Types.Mixed },
        archivedAt: { type: Date },
    },
    { timestamps: true }
);

schema.index({ user: 1, bootcamp: 1, createdAt: -1 });

export const BootcampPaymentAttemptModel = model<IBootcampPaymentAttempt>(
    'BootcampPaymentAttempt',
    schema
);
