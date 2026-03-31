import { Types } from 'mongoose';
import { EnrollmentStatus } from '../../types/common.js';

export interface IEnrollment {
    _id?: Types.ObjectId;
    userId: Types.ObjectId;
    batchId: Types.ObjectId;
    enrollmentId?: string; // Optional - assigned after payment confirmation
    paymentId?: Types.ObjectId;
    status: EnrollmentStatus;
    enrolledAt: Date;
    completedAt?: Date;
    certificateIssued: boolean;
    certificateId?: string;
    // Lifetime access - no expiry unless user is banned/suspended
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEnrollmentPopulated extends Omit<IEnrollment, 'userId' | 'batchId'> {
    userId: {
        _id: Types.ObjectId;
        name: string;
        email: string;
        avatar?: string;
    };
    batchId: {
        _id: Types.ObjectId;
        title: string;
        startDate: Date;
        endDate: Date;
        courseId: any;
    };
}
