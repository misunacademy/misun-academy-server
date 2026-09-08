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
    recordedCourseId?: Types.ObjectId;
    recordedBatchId?: Types.ObjectId;
    lessonsCount: number;
    durationMinutes: number;
    createdBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}
