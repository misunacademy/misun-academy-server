import { Schema, model } from 'mongoose';
import {
    IEnrollmentPerkRuleDocument,
    IPerkBenefit,
    PerkBenefitType,
} from './enrollmentPerk.interface.js';

const perkBenefitSchema = new Schema<IPerkBenefit>(
    {
        type: {
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
        targetBootcampId: {
            type: Schema.Types.ObjectId,
            ref: 'Bootcamp',
        },
        accessDuration: {
            type: {
                type: String,
                enum: ['lifetime', 'days'],
                default: 'lifetime',
            },
            days: {
                type: Number,
                min: 1,
            },
        },
        extraConfig: {
            type: Schema.Types.Mixed,
            default: {},
        },
    },
    { _id: false }
);

const enrollmentPerkRuleSchema = new Schema<IEnrollmentPerkRuleDocument>(
    {
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        note: {
            type: String,
            trim: true,
        },
        revokeOnCancel: {
            type: Boolean,
            default: true,
        },
        applyToAdminGrants: {
            type: Boolean,
            default: true,
        },
        benefits: {
            type: [perkBenefitSchema],
            validate: {
                validator: (val: IPerkBenefit[]) => Array.isArray(val) && val.length > 0,
                message: 'At least one benefit is required for a perk rule',
            },
            required: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
// Single active rule per course + batch
enrollmentPerkRuleSchema.index(
    { courseId: 1, batchId: 1 },
    {
        unique: true,
        partialFilterExpression: { isActive: true },
        name: 'unique_active_rule_per_course_batch',
    }
);
enrollmentPerkRuleSchema.index({ courseId: 1, batchId: 1 });
enrollmentPerkRuleSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

export const EnrollmentPerkRuleModel = model<IEnrollmentPerkRuleDocument>(
    'EnrollmentPerkRule',
    enrollmentPerkRuleSchema
);
