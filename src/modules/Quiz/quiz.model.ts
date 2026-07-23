import { Schema, model } from 'mongoose';
import { QuizStatus } from '../../types/common.js';
import { IQuiz, IContentBlock } from './quiz.interface.js';

export const ContentBlockSchema = new Schema<IContentBlock>(
    {
        type: {
            type: String,
            enum: ['text', 'image', 'text_image', 'audio', 'video'],
            required: true,
        },
        text: { type: String },
        imageUrl: { type: String },
        audioUrl: { type: String },
        videoUrl: { type: String },
        altText: { type: String },
    },
    { _id: false }
);

const quizSchema = new Schema<IQuiz>(
    {
        moduleId: {
            type: Schema.Types.ObjectId,
            ref: 'Module',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        description: { type: String },
        instructions: { type: String },
        passingPercentage: {
            type: Number,
            required: true,
            default: 50,
            min: 0,
            max: 100,
        },
        totalMarks: {
            type: Number,
            required: true,
            default: 0,
        },
        totalQuestions: {
            type: Number,
            required: true,
            default: 0,
        },
        timeLimit: { type: Number },
        shuffleQuestions: {
            type: Boolean,
            default: false,
        },
        shuffleOptions: {
            type: Boolean,
            default: false,
        },
        maxAttempts: {
            type: Number,
            default: 1,
        },
        showCorrectAnswers: {
            type: Boolean,
            default: false,
        },
        allowReview: {
            type: Boolean,
            default: true,
        },
        status: {
            type: String,
            enum: Object.values(QuizStatus),
            default: QuizStatus.Draft,
        },
        orderIndex: {
            type: Number,
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

quizSchema.index({ moduleId: 1, orderIndex: 1 });
quizSchema.index({ status: 1 });

export const QuizModel = model<IQuiz>('Quiz', quizSchema);
