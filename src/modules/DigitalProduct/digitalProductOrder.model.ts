import { Schema, model } from 'mongoose';
import { IDigitalProductOrder } from './digitalProductOrder.interface.js';

const digitalProductCustomerSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true },
        phone: { type: String, required: true, trim: true },
        country: { type: String, default: 'BD', uppercase: true, trim: true },
    },
    { _id: false }
);

const digitalProductOrderSchema = new Schema<IDigitalProductOrder>(
    {
        orderNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        product: {
            type: Schema.Types.ObjectId,
            ref: 'DigitalProduct',
            required: true,
            index: true,
        },
        productSnapshot: {
            title: { type: String, required: true },
            slug: { type: String, required: true },
            software: { type: String, required: true },
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        customer: {
            type: digitalProductCustomerSchema,
            required: true,
        },
        paymentMethod: {
            type: String,
            enum: ['SSLCommerz', 'PhonePe_Manual', 'Perk'],
            required: true,
            index: true,
        },
        currency: {
            type: String,
            enum: ['BDT', 'INR'],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        transactionId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        senderNumber: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: ['pending', 'paid', 'rejected'],
            default: 'pending',
            index: true,
        },
        gatewayResponse: {
            type: Schema.Types.Mixed,
        },
        adminNote: {
            type: String,
            trim: true,
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        reviewedAt: {
            type: Date,
        },
        downloadToken: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        downloadCount: {
            type: Number,
            default: 0,
        },
        valId: {
            type: String,
            sparse: true,
        },
    },
    {
        timestamps: true,
    }
);

digitalProductOrderSchema.index({ 'customer.email': 1 });
digitalProductOrderSchema.index({ createdAt: -1 });

export const DigitalProductOrderModel = model<IDigitalProductOrder>(
    'DigitalProductOrder',
    digitalProductOrderSchema
);
