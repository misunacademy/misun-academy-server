import { Schema, model } from 'mongoose';
import { QuestionType } from '../../types/common.js';
import { IQuestion } from './question.interface.js';
import { ContentBlockSchema } from './quiz.model.js';

const questionSchema = new Schema<IQuestion>(
    {
        quizId: {
            type: Schema.Types.ObjectId,
            ref: 'Quiz',
            required: true,
        },
        questionType: {
            type: String,
            enum: Object.values(QuestionType),
            required: true,
        },
        content: {
            type: ContentBlockSchema,
            required: true,
        },
        options: {
            type: [ContentBlockSchema],
            validate: {
                validator: function (this: IQuestion, options: any[]) {
                    if (this.questionType === QuestionType.MCQ) {
                        return options.length >= 2 && options.length <= 6;
                    }
                    return options.length === 2;
                },
                message: 'Invalid number of options for the question type',
            },
        },
        correctAnswer: {
            type: String,
            required: true,
        },
        explanation: { type: ContentBlockSchema },
        marks: {
            type: Number,
            required: true,
            default: 1,
            min: 0,
        },
        zamesPoints: {
            type: Number,
            default: 1,
            min: 0,
        },
        orderIndex: {
            type: Number,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

questionSchema.index({ quizId: 1, orderIndex: 1 });

export const QuestionModel = model<IQuestion>('Question', questionSchema);
