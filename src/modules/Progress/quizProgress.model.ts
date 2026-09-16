import { Schema, model } from 'mongoose';
import { IQuizProgress } from './quizProgress.interface.js';

const quizProgressSchema = new Schema<IQuizProgress>(
    {
        enrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
        },
        quizId: {
            type: Schema.Types.ObjectId,
            ref: 'Quiz',
            required: true,
        },
        status: {
            type: String,
            enum: ['completed'],
            default: 'completed',
        },
        passed: {
            type: Boolean,
            default: false,
        },
        score: {
            type: Number,
            default: 0,
        },
        attemptId: {
            type: Schema.Types.ObjectId,
            ref: 'QuizAttempt',
        },
        completedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

quizProgressSchema.index({ enrollmentId: 1, quizId: 1 }, { unique: true });
quizProgressSchema.index({ enrollmentId: 1, status: 1 });

export const QuizProgressModel = model<IQuizProgress>('QuizProgress', quizProgressSchema);
