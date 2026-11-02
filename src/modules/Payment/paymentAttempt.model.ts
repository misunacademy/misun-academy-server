import { Schema, Types, model } from 'mongoose';
import { Status } from '../../types/common.js';

export interface IPaymentAttempt {
    userId: Types.ObjectId;
    batchId: Types.ObjectId;
    enrollmentRef: Types.ObjectId;
    transactionId: string;
    amount: number;
    currency: string;
    status: Status;
    method: string;
    gatewayResponse?: Record<string, unknown>;
    archivedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const paymentAttemptSchema = new Schema<IPaymentAttempt>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
        enrollmentRef: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
        transactionId: { type: String, required: true, unique: true },
        amount: { type: Number, required: true },
        currency: { type: String, default: 'BDT' },
        status: { type: String, enum: Object.values(Status), default: Status.Pending },
        method: { type: String, required: true },
        gatewayResponse: { type: Schema.Types.Mixed },
        archivedAt: { type: Date },
        valId: { type: String, sparse: true, unique: true },
    },
    { timestamps: true }
);

paymentAttemptSchema.index({ enrollmentRef: 1, createdAt: -1 });

export const PaymentAttemptModel = model<IPaymentAttempt>(
    'PaymentAttempt',
    paymentAttemptSchema
);
