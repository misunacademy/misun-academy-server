import { Schema, model } from 'mongoose';
import { LessonProgressStatus } from '../../types/common.js';
import { ILessonProgress } from './lessonProgress.interface.js';

const lessonProgressSchema = new Schema<ILessonProgress>(
    {
        enrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
        },
        lessonId: {
            type: Schema.Types.ObjectId,
            ref: 'Lesson',
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(LessonProgressStatus),
            default: LessonProgressStatus.NotStarted,
        },
        watchTime: {
            type: Number,
            default: 0,
        },
        lastWatchedPosition: {
            type: Number,
            default: 0,
        },
        completedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// Unique index to prevent duplicate progress records
lessonProgressSchema.index({ enrollmentId: 1, lessonId: 1 }, { unique: true });
lessonProgressSchema.index({ enrollmentId: 1, status: 1 });

export const LessonProgressModel = model<ILessonProgress>('LessonProgress', lessonProgressSchema);
