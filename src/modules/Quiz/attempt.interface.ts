import { Types } from 'mongoose';
import { AttemptStatus } from '../../types/common.js';

export interface IQuizAnswer {
    questionId: Types.ObjectId;
    selectedAnswer: string | null;
    isCorrect: boolean;
    marksAwarded: number;
}

export interface IQuizAttempt {
    _id?: Types.ObjectId;
    quizId: Types.ObjectId;
    userId: Types.ObjectId;
    enrollmentId: Types.ObjectId;
    attemptNumber: number;
    answers: IQuizAnswer[];
    totalMarks: number;
    earnedMarks: number;
    percentage: number;
    passed: boolean;
    correctCount: number;
    wrongCount: number;
    unansweredCount: number;
    zamesEarned: number;
    startedAt: Date;
    submittedAt?: Date;
    timeTaken?: number;
    expired?: boolean;
    status: AttemptStatus;
    createdAt?: Date;
    updatedAt?: Date;
}
