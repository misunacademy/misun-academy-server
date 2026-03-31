import { Types } from 'mongoose';
import { CourseStatus, CourseLevel } from '../../types/common.js';

export interface ICourse {
    _id?: Types.ObjectId;
    title: string;
    slug: string;
    shortDescription: string;
    fullDescription: string;
    learningOutcomes: string[];
    prerequisites?: string[];
    targetAudience: string;
    thumbnailImage: string;
    coverImage?: string;
    durationEstimate: string;
    level: CourseLevel;
    category: string;
    tags: string[];
    featured: boolean;
    status: CourseStatus;
    isCertificateAvailable?: boolean;
    price: number;
    discountPercentage?: number;
    instructor?: string;
    features?: string[];
    highlights?: string[];
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ICourseWithBatches extends ICourse {
    upcomingBatches?: any[];
    totalBatches?: number;
}

export interface GetCoursesParams {
    category?: string;
    level?: CourseLevel;
    status?: CourseStatus;
    search?: string;
    featured?: boolean;
    page?: number;
    limit?: number;
}
