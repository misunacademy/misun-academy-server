import { Schema, model } from 'mongoose';
import { AttemptStatus } from '../../types/common.js';
import { IQuizAttempt, IQuizAnswer } from './attempt.interface.js';

const QuizAnswerSchema = new Schema<IQuizAnswer>(
    {
        questionId: {
            type: Schema.Types.ObjectId,
            ref: 'Question',
            required: true,
        },
        selectedAnswer: { type: String, default: null },
        isCorrect: { type: Boolean, required: true },
        marksAwarded: { type: Number, required: true, default: 0 },
    },
    { _id: false }
);

const attemptSchema = new Schema<IQuizAttempt>(
    {
        quizId: {
            type: Schema.Types.ObjectId,
            ref: 'Quiz',
            required: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        enrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
        },
        attemptNumber: {
            type: Number,
            required: true,
        },
        answers: {
            type: [QuizAnswerSchema],
            default: [],
        },
        totalMarks: { type: Number, required: true, default: 0 },
        earnedMarks: { type: Number, required: true, default: 0 },
        percentage: { type: Number, required: true, default: 0 },
        passed: { type: Boolean, required: true, default: false },
        correctCount: { type: Number, required: true, default: 0 },
        wrongCount: { type: Number, required: true, default: 0 },
        unansweredCount: { type: Number, required: true, default: 0 },
        zamesEarned: { type: Number, required: true, default: 0 },
        startedAt: { type: Date, required: true },
        submittedAt: { type: Date },
        timeTaken: { type: Number },
        status: {
            type: String,
            enum: Object.values(AttemptStatus),
            required: true,
            default: AttemptStatus.InProgress,
        },
    },
    {
        timestamps: true,
    }
);

attemptSchema.index({ quizId: 1, userId: 1, attemptNumber: 1 }, { unique: true });
attemptSchema.index({ userId: 1 });
attemptSchema.index({ enrollmentId: 1 });
attemptSchema.index({ status: 1 });

export const QuizAttemptModel = model<IQuizAttempt>('QuizAttempt', attemptSchema);
