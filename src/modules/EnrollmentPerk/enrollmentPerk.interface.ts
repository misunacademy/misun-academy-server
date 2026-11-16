import { Types, Document } from 'mongoose';

export enum PerkBenefitType {
    FreeCourse = 'free_course',
    FreeBootcamp = 'free_bootcamp',
    DiscountCoupon = 'discount_coupon',
    Resource = 'resource',
    Certificate = 'certificate',
    Mentorship = 'mentorship',
}

export type AccessDurationType = 'lifetime' | 'days';

export interface IPerkAccessDuration {
    type: AccessDurationType;
    days?: number;
}

export interface IPerkBenefit {
    type: PerkBenefitType;
    targetCourseId?: Types.ObjectId;
    targetBatchId?: Types.ObjectId;
    targetBootcampId?: Types.ObjectId;
    accessDuration?: IPerkAccessDuration;
    extraConfig?: Record<string, unknown>;
}

export interface IEnrollmentPerkRule {
    _id?: Types.ObjectId;
    courseId: Types.ObjectId;
    batchId: Types.ObjectId;
    title: string;
    isActive: boolean;
    startDate?: Date;
    endDate?: Date;
    note?: string;
    revokeOnCancel: boolean;
    applyToAdminGrants: boolean;
    benefits: IPerkBenefit[];
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IEnrollmentPerkRuleDocument extends Document, Omit<IEnrollmentPerkRule, '_id'> {}

export type PerkGrantStatus = 'granted' | 'revoked';

export interface IPerkGrant {
    _id?: Types.ObjectId;
    studentId: Types.ObjectId;
    ruleId: Types.ObjectId;
    benefitType: PerkBenefitType;
    targetCourseId?: Types.ObjectId;
    targetBatchId?: Types.ObjectId;
    targetEnrollmentId?: Types.ObjectId;
    targetBootcampId?: Types.ObjectId;
    targetBootcampPurchaseId?: Types.ObjectId;
    sourceEnrollmentId: Types.ObjectId;
    status: PerkGrantStatus;
    grantedAt: Date;
    revokedAt?: Date;
    revokeReason?: string;
    grantedBy?: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface IPerkGrantDocument extends Document, Omit<IPerkGrant, '_id'> {}
