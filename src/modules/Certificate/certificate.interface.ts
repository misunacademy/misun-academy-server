import { Types } from 'mongoose';
import { CertificateStatus } from '../../types/common.js';

export interface ICertificate {
    _id?: Types.ObjectId;
    enrollmentId: Types.ObjectId;
    userId: Types.ObjectId;
    batchId: Types.ObjectId;
    courseId: Types.ObjectId;
    certificateId: string;
    issueDate: Date;
    certificateUrl: string;
    blockchainHash?: string;
    verificationUrl: string;
    issuedBy: Types.ObjectId;
    status: CertificateStatus;
    revokedAt?: Date;
    revokedReason?: string;
    createdAt?: Date;
    updatedAt?: Date;
}
