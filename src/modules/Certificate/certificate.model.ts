import { Schema, model } from 'mongoose';
import { CertificateStatus } from '../../types/common.js';
import { ICertificate } from './certificate.interface.js';

const certificateSchema = new Schema<ICertificate>(
    {
        enrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
            required: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        certificateId: {
            type: String,
            required: true,
        },
        issueDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        certificateUrl: {
            type: String,
            required: true,
        },
        blockchainHash: {
            type: String,
        },
        verificationUrl: {
            type: String,
            required: true,
        },
        issuedBy: {
            type: Schema.Types.ObjectId,
            required: true,
            refPath: 'issuedByModel',
        },
        status: {
            type: String,
            enum: Object.values(CertificateStatus),
            default: CertificateStatus.Active,
        },
        revokedAt: {
            type: Date,
        },
        revokedReason: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
certificateSchema.index({ certificateId: 1 }, { unique: true });
certificateSchema.index({ enrollmentId: 1 }, { unique: true });
certificateSchema.index({ userId: 1 });
certificateSchema.index({ status: 1 });

export const CertificateModel = model<ICertificate>('Certificate', certificateSchema);
