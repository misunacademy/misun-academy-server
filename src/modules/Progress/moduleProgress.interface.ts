import { Types } from 'mongoose';
import { ProgressStatus } from '../../types/common.js';

export interface IModuleProgress {
    _id?: Types.ObjectId;
    enrollmentId: Types.ObjectId;
    moduleId: Types.ObjectId;
    status: ProgressStatus;
    unlockedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    completionPercentage: number;
    createdAt?: Date;
    updatedAt?: Date;
}
