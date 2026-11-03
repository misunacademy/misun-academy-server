import { Schema, model } from 'mongoose';
import { IBootcampPurchase, BootcampPurchaseStatus } from './bootcampCatalog.interface.js';

const bootcampPurchaseSchema = new Schema<IBootcampPurchase>(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        bootcamp: { type: Schema.Types.ObjectId, ref: 'Bootcamp', required: true, index: true },
        amount: { type: Number, required: true, min: 0 },
        method: { type: String, enum: ['manual', 'SSLCommerz'], default: 'SSLCommerz' },
        transactionId: { type: String, required: true, trim: true },
        status: { type: String, enum: Object.values(BootcampPurchaseStatus), default: BootcampPurchaseStatus.Pending, index: true },
        gatewayResponse: { type: Schema.Types.Mixed },
        adminNote: { type: String, trim: true },
        reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        reviewedAt: { type: Date },
        archivedAt: { type: Date },
        valId: { type: String, sparse: true, unique: true },
    },
    { timestamps: true }
);

bootcampPurchaseSchema.index({ createdAt: -1 });
bootcampPurchaseSchema.index(
    { user: 1, bootcamp: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: BootcampPurchaseStatus.Pending,
        },
        name: 'one_pending_bootcamp_purchase_per_user',
    }
);

export const BootcampPurchaseModel = model<IBootcampPurchase>('BootcampPurchase', bootcampPurchaseSchema);
