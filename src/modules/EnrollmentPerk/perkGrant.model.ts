import { Schema, model } from 'mongoose';
import { IPerkGrantDocument, PerkBenefitType } from './enrollmentPerk.interface.js';

const perkGrantSchema = new Schema<IPerkGrantDocument>(
    {
        studentId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        ruleId: {
            type: Schema.Types.ObjectId,
            ref: 'EnrollmentPerkRule',
            required: true,
        },
        benefitType: {
            type: String,
            enum: Object.values(PerkBenefitType),
            default: PerkBenefitType.FreeCourse,
            required: true,
        },
        targetCourseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
        },
        targetBatchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
        },
        targetEnrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
        },
        targetBootcampId: {
            type: Schema.Types.ObjectId,
            ref: 'Bootcamp',
        },
        targetBootcampPurchaseId: {
            type: Schema.Types.ObjectId,
            ref: 'BootcampPurchase',
        },
        sourceEnrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
        },
        status: {
            type: String,
            enum: ['granted', 'revoked'],
            default: 'granted',
            required: true,
        },
        grantedAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
        revokedAt: {
            type: Date,
        },
        revokeReason: {
            type: String,
        },
        grantedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
perkGrantSchema.index({ studentId: 1, targetCourseId: 1 });
perkGrantSchema.index({ ruleId: 1, studentId: 1 });
perkGrantSchema.index({ sourceEnrollmentId: 1 });
perkGrantSchema.index({ status: 1, grantedAt: -1 });

export const PerkGrantModel = model<IPerkGrantDocument>('PerkGrant', perkGrantSchema);
