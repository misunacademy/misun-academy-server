import { Schema, model } from 'mongoose';
import { CourseStatus, CourseLevel } from '../../types/common';
import { ICourse } from './course.interface';

const courseSchema = new Schema<ICourse>(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            lowercase: true,
        },
        shortDescription: {
            type: String,
            required: true,
            maxlength: 300,
        },
        fullDescription: {
            type: String,
            required: true,
        },
        learningOutcomes: {
            type: [String],
            required: true,
        },
        prerequisites: [String],
        targetAudience: {
            type: String,
            required: true,
        },
        thumbnailImage: {
            type: String,
            required: true,
        },
        coverImage: String,
        durationEstimate: {
            type: String,
            required: true,
        },
        level: {
            type: String,
            enum: Object.values(CourseLevel),
            required: true,
        },
        category: {
            type: String,
            required: true,
        },
        tags: {
            type: [String],
            default: [],
        },
        featured: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: Object.values(CourseStatus),
            default: CourseStatus.Draft,
        },
        isCertificateAvailable: {
            type: Boolean,
            default: true,
        },
        instructor: {
            type: String,
        },
        features: {
            type: [String],
            default: [],
        },
        highlights: {
            type: [String],
            default: [],
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for efficient queries
courseSchema.index({ slug: 1 }, { unique: true });
courseSchema.index({ status: 1 });
courseSchema.index({ category: 1, level: 1 });
courseSchema.index({ featured: 1, status: 1 });
courseSchema.index({ tags: 1 });

export const CourseModel = model<ICourse>('Course', courseSchema);
