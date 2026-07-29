import { Schema, model, Types } from 'mongoose';
import { ZamesSource } from '../../types/common.js';

export interface IZamesTransaction {
    _id?: Types.ObjectId;
    userId: Types.ObjectId;
    courseId?: Types.ObjectId;
    batchId?: Types.ObjectId;
    quizAttemptId?: Types.ObjectId;
    quizId?: Types.ObjectId;
    source: ZamesSource;
    points: number;
    balanceBefore: number;
    balanceAfter: number;
    metadata?: Record<string, any>;
    createdAt?: Date;
}

const zamesTransactionSchema = new Schema<IZamesTransaction>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
        },
        quizAttemptId: {
            type: Schema.Types.ObjectId,
            ref: 'QuizAttempt',
        },
        quizId: {
            type: Schema.Types.ObjectId,
            ref: 'Quiz',
        },
        source: {
            type: String,
            enum: Object.values(ZamesSource),
            required: true,
        },
        points: {
            type: Number,
            required: true,
        },
        balanceBefore: {
            type: Number,
            required: true,
        },
        balanceAfter: {
            type: Number,
            required: true,
        },
        metadata: {
            type: Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

zamesTransactionSchema.index({ userId: 1, courseId: 1, batchId: 1, createdAt: -1 });
zamesTransactionSchema.index({ courseId: 1, batchId: 1, createdAt: -1 });
zamesTransactionSchema.index({ source: 1 });

export const ZamesTransactionModel = model<IZamesTransaction>('ZamesTransaction', zamesTransactionSchema);
