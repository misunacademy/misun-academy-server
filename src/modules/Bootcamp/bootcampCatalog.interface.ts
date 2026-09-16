import { Types } from 'mongoose';

export enum BootcampStatus {
    Draft = 'draft',
    Upcoming = 'upcoming',
    Live = 'live',
    Completed = 'completed',
    Archived = 'archived',
}

export enum RecordedStatus {
    Draft = 'draft',
    Published = 'published',
}

export interface IBootcampPerk {
    title: string;
    description: string;
}

export interface IBootcampScheduleItem {
    day: string;
    dose?: string;
    title: string;
    description: string;
}

export interface IBootcampFaq {
    question: string;
    answer: string;
}

export interface IBootcampPaymentMethod {
    label: string;
    number: string;
    type: string;
}

export interface IBootcampVideo {
    _id?: Types.ObjectId;
    title: string;
    description?: string;
    videoSource: 'youtube' | 'googledrive';
    videoId: string;
    videoUrl?: string;
    duration?: number; // seconds
    orderIndex: number;
    isPublished: boolean;
}

export interface IBootcampCatalog {
    _id?: Types.ObjectId;
    title: string;
    season: string;
    slug: string;
    tagline?: string;
    description?: string;
    status: BootcampStatus;
    startDate?: Date;
    endDate?: Date;
    time?: string;
    platform?: string;
    liveFee: number;
    recordedPrice: number;
    recordedStatus: RecordedStatus;
    thumbnail?: string;
    posterImage?: string;
    perks: IBootcampPerk[];
    schedule: IBootcampScheduleItem[];
    faq: IBootcampFaq[];
    paymentMethods: IBootcampPaymentMethod[];
    registrationOpen: boolean;
    /** @deprecated legacy link kept for migration only — bootcamps no longer depend on Course/Batch */
    recordedCourseId?: Types.ObjectId;
    /** @deprecated legacy link kept for migration only */
    recordedBatchId?: Types.ObjectId;
    videos: IBootcampVideo[];
    lessonsCount: number;
    durationMinutes: number;
    createdBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export enum BootcampPurchaseStatus {
    Pending = 'pending',
    Paid = 'paid',
    Rejected = 'rejected',
}

export interface IBootcampPurchase {
    _id?: Types.ObjectId;
    user: Types.ObjectId;
    bootcamp: Types.ObjectId;
    amount: number;
    method: 'manual' | 'SSLCommerz';
    transactionId: string;
    status: BootcampPurchaseStatus;
    gatewayResponse?: Record<string, unknown>;
    adminNote?: string;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}
