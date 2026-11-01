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

// A resource must attach to at least one parent — otherwise it is an orphan
// no listing query will ever return.
resourceSchema.pre('validate', function (next) {
    if (!this.lessonId && !this.moduleId) {
        return next(new Error('Resource must belong to a lesson or a module'));
    }
    next();
});

export const ResourceModel = model<IResource>('Resource', resourceSchema);
