import { Schema, model } from 'mongoose';
import { ResourceType } from '../../types/common.js';
import { IResource } from './resource.interface.js';

const resourceSchema = new Schema<IResource>(
    {
        lessonId: {
            type: Schema.Types.ObjectId,
            ref: 'Lesson',
        },
        moduleId: {
            type: Schema.Types.ObjectId,
            ref: 'Module',
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
            enum: Object.values(ResourceType),
            required: true,
        },
        fileUrl: {
            type: String,
        },
        fileName: {
            type: String,
        },
        fileSize: {
            type: Number,
        },
        externalLink: {
            type: String,
        },
        orderIndex: {
            type: Number,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
resourceSchema.index({ lessonId: 1 });
resourceSchema.index({ moduleId: 1 });
resourceSchema.index({ type: 1 });

export const ResourceModel = model<IResource>('Resource', resourceSchema);
