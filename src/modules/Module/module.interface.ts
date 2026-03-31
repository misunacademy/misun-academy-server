import { Types } from 'mongoose';
import { ProgressStatus } from '../../types/common.js';

export interface IModule {
    _id?: Types.ObjectId;
    courseId: Types.ObjectId;
    title: string;
    description: string;
    orderIndex: number;
    estimatedDuration: string;
    learningObjectives: string[];
    status: 'draft' | 'published';
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IModuleWithProgress extends IModule {
    progress?: ProgressStatus;
    completionPercentage?: number;
}
