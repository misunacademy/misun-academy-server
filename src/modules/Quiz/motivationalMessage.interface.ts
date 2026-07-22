import { Types } from 'mongoose';

export interface IMotivationalMessage {
    _id?: Types.ObjectId;
    minPercentage: number;
    maxPercentage: number;
    title: string;
    message: string;
    emoji?: string;
    isActive: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}
