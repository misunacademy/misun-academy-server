import { Schema, model, Types } from 'mongoose';
import { LeaderboardPeriod } from '../../types/common.js';

export interface ILeaderboardEntry {
    _id?: Types.ObjectId;
    userId: Types.ObjectId;
    courseId?: Types.ObjectId;
    batchId?: Types.ObjectId;
    period: LeaderboardPeriod;
    month?: number;
    year?: number;
    totalZames: number;
    quizzesCompleted: number;
    averageScore: number;
    totalMarks: number;
    lastActive: Date;
    rank?: number;
}

const leaderboardEntrySchema = new Schema<ILeaderboardEntry>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
        },
        period: {
            type: String,
            enum: Object.values(LeaderboardPeriod),
            required: true,
        },
        month: { type: Number },
        year: { type: Number },
        totalZames: { type: Number, required: true, default: 0 },
        quizzesCompleted: { type: Number, required: true, default: 0 },
        averageScore: { type: Number, required: true, default: 0 },
        totalMarks: { type: Number, required: true, default: 0 },
        lastActive: { type: Date, required: true },
        rank: { type: Number },
    },
    {
        timestamps: true,
    }
);

leaderboardEntrySchema.index({ period: 1, totalZames: -1 });
leaderboardEntrySchema.index({ period: 1, month: 1, year: 1, totalZames: -1 });
leaderboardEntrySchema.index({ userId: 1, period: 1 });
leaderboardEntrySchema.index({ courseId: 1, period: 1, totalZames: -1 });
leaderboardEntrySchema.index({ batchId: 1, period: 1, totalZames: -1 });

export const LeaderboardEntryModel = model<ILeaderboardEntry>('LeaderboardEntry', leaderboardEntrySchema);
