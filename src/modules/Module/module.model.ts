import { Schema, model } from 'mongoose';
import { IModule } from './module.interface.js';

const moduleSchema = new Schema<IModule>(
    {
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: true,
        },
        orderIndex: {
            type: Number,
            required: true,
        },
        estimatedDuration: {
            type: String,
            required: true,
        },
        learningObjectives: {
            type: [String],
            default: [],
        },
        status: {
            type: String,
            enum: ['draft', 'published'],
            default: 'draft',
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
moduleSchema.index({ courseId: 1, orderIndex: 1 });
moduleSchema.index({ status: 1 });

export const ModuleModel = model<IModule>('Module', moduleSchema);
