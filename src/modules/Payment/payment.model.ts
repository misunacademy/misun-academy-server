import { Schema, model, Types } from "mongoose";
import { Status } from "../../types/common.js";

export interface IPayment {
    userId: Types.ObjectId;
    batchId: Types.ObjectId;
    enrollmentId?: string;
    transactionId: string;
    amount: number;
    currency: string;
    status: Status;
    method: string;
    gatewayResponse?: any;
    // idempotencyKey?: string;
    verifiedAt?: Date;
    verifiedBy?: Types.ObjectId;
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
            unique: true,
            // sparse: true,
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
            enum: ["SSLCommerz", "PhonePay"],
            required: true,
        },
        gatewayResponse: {
            type: Schema.Types.Mixed,
        },
        // idempotencyKey: {
        //     type: String,
        //     unique: true,
        // },
        verifiedAt: {
            type: Date,
        },
        verifiedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
    },
    {
        timestamps: true,
    }
);


export const PaymentModel = model<IPayment>("Payment", paymentSchema);
