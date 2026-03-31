import { Schema, model } from 'mongoose';
import { ProgressStatus } from '../../types/common.js';
import { IModuleProgress } from './moduleProgress.interface.js';

const moduleProgressSchema = new Schema<IModuleProgress>(
    {
        enrollmentId: {
            type: Schema.Types.ObjectId,
            ref: 'Enrollment',
            required: true,
        },
        moduleId: {
            type: Schema.Types.ObjectId,
            ref: 'Module',
            required: true,
        },
        status: {
            type: String,
            enum: Object.values(ProgressStatus),
            default: ProgressStatus.Locked,
        },
        unlockedAt: {
            type: Date,
        },
        startedAt: {
            type: Date,
        },
        completedAt: {
            type: Date,
        },
        completionPercentage: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
    },
    {
        timestamps: true,
    }
);

// Unique index to prevent duplicate progress records
moduleProgressSchema.index({ enrollmentId: 1, moduleId: 1 }, { unique: true });
moduleProgressSchema.index({ enrollmentId: 1, status: 1 });

export const ModuleProgressModel = model<IModuleProgress>('ModuleProgress', moduleProgressSchema);
