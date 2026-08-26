import { Types } from 'mongoose';

export enum BootcampRegistrationStatus {
    Pending = 'pending',
    Verified = 'verified',
    Rejected = 'rejected',
}

export interface IBootcampRegistration {
    name: string;
    whatsapp?: string;
    address: string;
    email: string;
    paymentLast4: string;
    status: BootcampRegistrationStatus;
    adminNote?: string;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    registrationIp?: string;
    createdAt?: Date;
    updatedAt?: Date;
}
