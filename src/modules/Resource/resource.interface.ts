import { Types } from 'mongoose';
import { ResourceType } from '../../types/common.js';

export interface IResource {
    _id?: Types.ObjectId;
    lessonId?: Types.ObjectId;
    moduleId?: Types.ObjectId;
    title: string;
    description?: string;
    type: ResourceType;
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    externalLink?: string;
    orderIndex: number;
    createdAt?: Date;
    updatedAt?: Date;
}
