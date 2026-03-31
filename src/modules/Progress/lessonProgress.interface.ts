import { Types } from 'mongoose';
import { LessonProgressStatus } from '../../types/common.js';

export interface ILessonProgress {
    _id?: Types.ObjectId;
    enrollmentId: Types.ObjectId;
    lessonId: Types.ObjectId;
    status: LessonProgressStatus;
    watchTime?: number;
    lastWatchedPosition?: number;
    completedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}
