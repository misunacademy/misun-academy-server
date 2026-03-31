import { Schema, model } from 'mongoose';
import { IInstructor } from './instructor.interface.js';

const instructorSchema = new Schema<IInstructor>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        bio: {
            type: String,
            required: true,
        },
        expertise: {
            type: [String],
            required: true,
        },
        socialLinks: {
            linkedin: String,
            portfolio: String,
            github: String,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        rating: {
            type: Number,
            min: 0,
            max: 5,
        },
        totalBatchesTaught: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active',
        },
    },
    {
        timestamps: true,
    }
);

// Index for efficient queries
// instructorSchema.index({ userId: 1 });
instructorSchema.index({ status: 1 });
instructorSchema.index({ verified: 1 });

export const InstructorModel = model<IInstructor>('Instructor', instructorSchema);
