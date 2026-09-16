import { Schema, model } from 'mongoose';
import { IBootcampRegistration, BootcampRegistrationStatus } from './bootcamp.interface.js';

const bootcampRegistrationSchema = new Schema<IBootcampRegistration>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        whatsapp: {
            type: String,
            trim: true,
        },
        address: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        paymentLast4: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(BootcampRegistrationStatus),
            default: BootcampRegistrationStatus.Pending,
            index: true,
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
        registrationIp: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

bootcampRegistrationSchema.index({ email: 1 });
bootcampRegistrationSchema.index({ whatsapp: 1 });
bootcampRegistrationSchema.index({ createdAt: -1 });

export const BootcampRegistrationModel = model<IBootcampRegistration>(
    'BootcampRegistration',
    bootcampRegistrationSchema
);
