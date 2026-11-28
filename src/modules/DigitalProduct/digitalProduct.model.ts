import { Schema, model } from 'mongoose';
import { IDigitalProduct } from './digitalProduct.interface.js';

const digitalProductFileSchema = new Schema(
    {
        fileName: { type: String, trim: true },
        url: { type: String, trim: true },
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
            default: 0,
            min: 0,
        },
        discountPriceBDT: {
            type: Number,
            min: 0,
            nullable: true,
            default: null,
        },
        priceINR: {
            type: Number,
            default: 0,
            min: 0,
        },
        discountPriceINR: {
            type: Number,
            min: 0,
            nullable: true,
            default: null,
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
            required: false,
        },
        guidePdf: {
            type: digitalProductFileSchema,
            required: false,
        },
        status: {
            type: String,
            enum: ['draft', 'published'],
            default: 'published',
            index: true,
        },
        isPublished: {
            type: Boolean,
            default: true,
            index: true,
        },
        // Manual display order controlled by admins via drag & drop.
        // Lower values appear first in both the storefront and admin list.
        sortOrder: {
            type: Number,
            default: 0,
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

digitalProductSchema.index({ isPublished: 1, sortOrder: 1, createdAt: -1 });

export const DigitalProductModel = model<IDigitalProduct>('DigitalProduct', digitalProductSchema);
