import { Types } from 'mongoose';
import { QuestionType } from '../../types/common.js';
import { IContentBlock } from './quiz.interface.js';

export interface IQuestion {
    _id?: Types.ObjectId;
    quizId: Types.ObjectId;
    questionType: QuestionType;
    content: IContentBlock;
    options: IContentBlock[];
    correctAnswer: string;
    explanation?: IContentBlock;
    marks: number;
    zamesPoints: number;
    orderIndex: number;
    createdAt?: Date;
    updatedAt?: Date;
}
