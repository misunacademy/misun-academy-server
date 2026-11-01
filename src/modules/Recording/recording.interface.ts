import { Types } from 'mongoose';

export interface IRecording {
    _id?: Types.ObjectId;
    courseId: Types.ObjectId;
    batchId: Types.ObjectId;
    title: string;
    description?: string;
    sessionDate: Date;
    videoSource: 'youtube' | 'googledrive';
    videoId: string;
    videoUrl?: string;
    duration?: number; // in minutes
    thumbnailUrl?: string;
    instructor?: Types.ObjectId;
    tags?: string[];
    isPublished: boolean;
    viewCount?: number;
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
    // Content protection
    signedUrl?: string;
    signedUrlExpiresAt?: Date;
    recordingDrmProtected?: boolean;
    recordingWatermarked?: boolean;
}
