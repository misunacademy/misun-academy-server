import { Schema, model } from 'mongoose';
import { RefundChannel, RefundStatus, IRefund } from './refund.interface.js';

const refundSchema = new Schema<IRefund>(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    transactionId: { type: String, required: true, index: true },
    enrollmentId: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'BDT' },
    method: { type: String, required: true },
    channel: { type: String, enum: Object.values(RefundChannel), required: true },
    status: { type: String, enum: Object.values(RefundStatus), default: RefundStatus.Pending, index: true },
    reason: { type: String, required: true, maxlength: 500 },
    decisionNote: { type: String, maxlength: 500 },
    gatewayRef: { type: String },
    gatewayResponse: { type: Schema.Types.Mixed },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

refundSchema.index({ createdAt: -1 });
refundSchema.index({ status: 1, transactionId: 1 });

export const RefundModel = model<IRefund>('Refund', refundSchema);