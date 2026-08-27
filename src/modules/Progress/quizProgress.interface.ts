import { Types } from 'mongoose';

export interface IQuizProgress {
    _id?: Types.ObjectId;
    enrollmentId: Types.ObjectId;
    quizId: Types.ObjectId;
    status: 'completed';
    passed: boolean;
    score: number;
    attemptId: Types.ObjectId;
    completedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}
