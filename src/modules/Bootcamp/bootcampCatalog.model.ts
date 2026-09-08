import { Schema, model } from 'mongoose';
import { IBootcampCatalog, BootcampStatus, RecordedStatus } from './bootcampCatalog.interface.js';

const bootcampCatalogSchema = new Schema<IBootcampCatalog>(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        season: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        tagline: {
            type: String,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: Object.values(BootcampStatus),
            default: BootcampStatus.Draft,
            index: true,
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        time: {
            type: String,
            trim: true,
        },
        platform: {
            type: String,
            trim: true,
            default: 'Online (Zoom)',
        },
        liveFee: {
            type: Number,
            min: 0,
            default: 0,
        },
        recordedPrice: {
            type: Number,
            min: 0,
            default: 0,
        },
        recordedStatus: {
            type: String,
            enum: Object.values(RecordedStatus),
            default: RecordedStatus.Draft,
            index: true,
        },
        thumbnail: {
            type: String,
            trim: true,
        },
        posterImage: {
            type: String,
            trim: true,
        },
        perks: {
            type: [{ title: String, description: String }],
            default: [],
        },
        schedule: {
            type: [{ day: String, dose: String, title: String, description: String }],
            default: [],
        },
        faq: {
            type: [{ question: String, answer: String }],
            default: [],
        },
        paymentMethods: {
            type: [{ label: String, number: String, type: String }],
            default: [],
        },
        registrationOpen: {
            type: Boolean,
            default: false,
        },
        recordedCourseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
        },
        recordedBatchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
        },
        lessonsCount: {
            type: Number,
            default: 0,
        },
        durationMinutes: {
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

bootcampCatalogSchema.index({ slug: 1 }, { unique: true });
bootcampCatalogSchema.index({ status: 1, recordedStatus: 1 });
bootcampCatalogSchema.index({ createdAt: -1 });

export const BootcampCatalogModel = model<IBootcampCatalog>(
    'Bootcamp',
    bootcampCatalogSchema
);
