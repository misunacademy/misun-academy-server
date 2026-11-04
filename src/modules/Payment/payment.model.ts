import { Schema, model, Types } from "mongoose";
import { Status } from "../../types/common.js";

export interface IPayment {
    userId: Types.ObjectId;
    batchId: Types.ObjectId;
    enrollmentRef?: Types.ObjectId;
    enrollmentId?: string;
    transactionId: string;
    amount: number;
    currency: string;
    status: Status;
    method: string;
    gatewayResponse?: any;
    verifiedAt?: Date;
    verifiedBy?: Types.ObjectId;
    archivedAt?: Date;
    expiresAt?: Date;
    cancelledAt?: Date;
    failedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const paymentSchema = new Schema<IPayment>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: "Batch",
            required: true,
        },
        enrollmentId: {
            type: String,
            // Uniqueness enforced by sparse index below (allows multiple null/missing during creation)
        },
        enrollmentRef: {
            type: Schema.Types.ObjectId,
            ref: "Enrollment",
        },
        transactionId: {
            type: String,
            unique: true,
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            default: "BDT",
        },
        status: {
            type: String,
            enum: Object.values(Status),
            default: Status.Pending,
        },
        method: {
            type: String,
            enum: ["SSLCommerz", "PhonePay", "complimentary", "manual"],
            required: true,
        },
        gatewayResponse: {
            type: Schema.Types.Mixed,
        },
        verifiedAt: {
            type: Date,
        },
        verifiedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        archivedAt: {
            type: Date,
        },
        expiresAt: {
            type: Date,
        },
        cancelledAt: {
            type: Date,
        },
        failedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
        toJSON: {
            transform: (_, ret) => {
                if (ret.gatewayResponse && typeof ret.gatewayResponse === 'object') {
                    delete (ret.gatewayResponse as Record<string, unknown>).cardNumber;
                    delete (ret.gatewayResponse as Record<string, unknown>).cvv;
                    delete (ret.gatewayResponse as Record<string, unknown>).cardCvv;
                    delete (ret.gatewayResponse as Record<string, unknown>).securityCode;
                }
                return ret;
            },
        },
    }
);


// Indexes
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, batchId: 1 });
paymentSchema.index(
    { 'gatewayResponse.phonePeTransactionId': 1 },
    {
        unique: true,
        partialFilterExpression: { 'gatewayResponse.phonePeTransactionId': { $type: 'string' } },
    }
);
// enrollmentId is unique only among documents that actually hold one
// (null/"" / absent are ignored — never consume the counter on unpaid attempts).
paymentSchema.index({ enrollmentId: 1 }, { unique: true, partialFilterExpression: { enrollmentId: { $type: 'string' } } });
// At most one live attempt per enrollment (Pending or Review) to prevent
// double-charging. Terminal/cancelled/failed/expired attempts don't count.
// This index also serves as the enrollmentRef lookup index.
paymentSchema.index(
    { enrollmentRef: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: { $in: ['pending', 'review'] },
        },
    }
);

export const PaymentModel = model<IPayment>("Payment", paymentSchema);
