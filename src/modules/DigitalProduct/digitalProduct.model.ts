import { Schema, model } from 'mongoose';
import { IDigitalProduct } from './digitalProduct.interface.js';

const digitalProductFileSchema = new Schema(
    {
        fileName: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
        fileSize: { type: String, trim: true },
    },
    { _id: false }
);

const digitalProductSchema = new Schema<IDigitalProduct>(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        tagline: {
            type: String,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        software: {
            type: String,
            enum: ['photoshop', 'illustrator', 'bundle', 'other'],
            default: 'other',
            index: true,
        },
        priceBDT: {
            type: Number,
            required: true,
            min: 0,
        },
        discountPriceBDT: {
            type: Number,
            min: 0,
        },
        priceINR: {
            type: Number,
            required: true,
            min: 0,
        },
        discountPriceINR: {
            type: Number,
            min: 0,
        },
        thumbnail: {
            type: String,
            trim: true,
        },
        badge: {
            type: String,
            trim: true,
        },
        features: {
            type: [String],
            default: [],
        },
        scriptFile: {
            type: digitalProductFileSchema,
            required: true,
        },
        guidePdf: {
            type: digitalProductFileSchema,
            required: true,
        },
        isPublished: {
            type: Boolean,
            default: true,
            index: true,
        },
        salesCount: {
            type: Number,
            default: 0,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        timestamps: true,
    }
);

digitalProductSchema.index({ isPublished: 1, createdAt: -1 });

export const DigitalProductModel = model<IDigitalProduct>('DigitalProduct', digitalProductSchema);
