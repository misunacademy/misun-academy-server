import { Types } from 'mongoose';
import { QuizStatus } from '../../types/common.js';

export interface IContentBlock {
    type: 'text' | 'image' | 'text_image' | 'audio' | 'video';
    text?: string;
    imageUrl?: string;
    audioUrl?: string;
    videoUrl?: string;
    altText?: string;
}

export interface IQuiz {
    _id?: Types.ObjectId;
    moduleId: Types.ObjectId;
    title: string;
    slug: string;
    description?: string;
    instructions?: string;
    passingPercentage: number;
    totalMarks: number;
    totalQuestions: number;
    timeLimit?: number;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    maxAttempts: number;
    showCorrectAnswers: boolean;
    allowReview: boolean;
    status: QuizStatus;
    orderIndex: number;
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}
