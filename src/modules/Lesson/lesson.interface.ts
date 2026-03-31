import { Types } from 'mongoose';
import { LessonType, VideoSource, LessonProgressStatus } from '../../types/common.js';
import { ILessonResource } from './lesson.model.js';

export interface ILesson {
    _id?: Types.ObjectId;
    moduleId: Types.ObjectId;
    title: string;
    description?: string;
    type: LessonType;
    orderIndex: number;
    videoSource?: VideoSource;
    videoId?: string;
    videoUrl?: string;
    videoDuration?: number;
    content?: string;
    isMandatory: boolean;
    resources?: ILessonResource[];
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ILessonWithProgress extends ILesson {
    progress?: LessonProgressStatus;
    watchTime?: number;
    completed?: boolean;
}
