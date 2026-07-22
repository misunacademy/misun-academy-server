import { Schema, model } from 'mongoose';
import { IMotivationalMessage } from './motivationalMessage.interface.js';

const motivationalMessageSchema = new Schema<IMotivationalMessage>(
    {
        minPercentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },
        maxPercentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        message: {
            type: String,
            required: true,
            trim: true,
        },
        emoji: { type: String },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

export const MotivationalMessageModel = model<IMotivationalMessage>(
    'MotivationalMessage',
    motivationalMessageSchema
);
