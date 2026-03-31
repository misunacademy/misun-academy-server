import { Schema, model } from 'mongoose';
import { VideoSource } from '../../types/common.js';
import { IRecording } from './recording.interface.js';

const recordingSchema = new Schema<IRecording>(
    {
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
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
        sessionDate: {
            type: Date,
            required: true,
        },
        videoSource: {
            type: String,
            enum: Object.values(VideoSource),
            required: true,
        },
        videoId: {
            type: String,
            required: true,
        },
        videoUrl: {
            type: String,
        },
        duration: {
            type: Number,
        },
        thumbnailUrl: {
            type: String,
        },
        instructor: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
        },
        tags: {
            type: [String],
            default: [],
        },
        isPublished: {
            type: Boolean,
            default: false,
        },
        viewCount: {
            type: Number,
            default: 0,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
recordingSchema.index({ batchId: 1, sessionDate: -1 });
recordingSchema.index({ courseId: 1 });
recordingSchema.index({ isPublished: 1 });

export const RecordingModel = model<IRecording>('Recording', recordingSchema);
