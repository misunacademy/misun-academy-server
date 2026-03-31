import { Schema, model, Document, Types } from 'mongoose';
import { BatchStatus } from '../../types/common.js';

export interface IBatch extends Document {
    courseId: Types.ObjectId;
    title: string;
    batchNumber: number;
    description?: string;
    startDate: Date;
    endDate: Date;
    enrollmentStartDate: Date;
    enrollmentEndDate: Date;
    price: number;
    manualPaymentPrice?: number;
    currency: string;
    currentEnrollment: number;
    status: BatchStatus;
    instructors: Types.ObjectId[];
    certificateTemplate?: string;
    accessDurationAfterEnd?: number;
    createdAt: Date;
    updatedAt: Date;
}

const batchSchema = new Schema<IBatch>(
    {
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        batchNumber: {
            type: Number,
            required: true,
        },
        description: {
            type: String,
        },
        startDate: {
            type: Date,
            required: true,
        },
        endDate: {
            type: Date,
            required: true,
        },
        enrollmentStartDate: {
            type: Date,
            required: true,
        },
        enrollmentEndDate: {
            type: Date,
            required: true,
        },
        price: {
            type: Number,
            required: true,
            min: 0,
        },
        manualPaymentPrice: {
            type: Number,
            min: 0,
        },
        currency: {
            type: String,
            default: 'BDT',
        },
        currentEnrollment: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: Object.values(BatchStatus),
            default: BatchStatus.Draft,
        },
        instructors: [{
            type: Schema.Types.ObjectId,
            ref: 'Instructor',
        }],
        certificateTemplate: {
            type: String,
        },
        accessDurationAfterEnd: {
            type: Number,
            default: 90,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
batchSchema.index({ courseId: 1, batchNumber: 1 }, { unique: true });
batchSchema.index({ status: 1, enrollmentEndDate: 1 });
batchSchema.index({ startDate: 1, endDate: 1 });

export const BatchModel = model<IBatch>('Batch', batchSchema);
