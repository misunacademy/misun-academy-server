import { Schema, model } from 'mongoose';
import { LessonType, VideoSource } from '../../types/common.js';
import { ILesson } from './lesson.interface.js';


enum IResourceType {
    Link = "link",
    Text = "text"
}
export interface ILessonResource {
    lessonId: string;
    title: string;
    type: IResourceType;
    url?: string;
    textContent?: string;
}

const lessonSchema = new Schema<ILesson>(
    {
        moduleId: {
            type: Schema.Types.ObjectId,
            ref: 'Module',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
        },
        type: {
            type: String,
            enum: Object.values(LessonType),
            required: true,
        },
        orderIndex: {
            type: Number,
            required: true,
        },
        videoSource: {
            type: String,
            enum: Object.values(VideoSource),
        },
        videoId: {
            type: String,
        },
        videoUrl: {
            type: String,
        },
        videoDuration: {
            type: Number,
        },
        content: {
            type: String,
        },
        isMandatory: {
            type: Boolean,
            default: true,
        },
        resources: [
            {
                title: { type: String, required: true },
                type: { type: String, enum: Object.values(IResourceType), required: true },
                url: { type: String },
                textContent: { type: String },
            }
        ],
    },
    {
        timestamps: true,
    }
);

// Indexes
lessonSchema.index({ moduleId: 1, orderIndex: 1 });
lessonSchema.index({ type: 1 });

export const LessonModel = model<ILesson>('Lesson', lessonSchema);
