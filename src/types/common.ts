import { IGenericErrorMessage } from './error.js';

export type IGenericResponse<T> = {
    meta: {
        page: number;
        limit: number;
        total: number;
    };
    data: T;
};

export type IGenericErrorResponse = {
    statusCode: number;
    message: string;
    errorMessages: IGenericErrorMessage[];
};

export enum Status {
    Pending = "pending",
    Success = "success",
    Failed = "failed",
    Review = "review",
    Risk = "risk",
    Cancel = "cancel"
}

export enum UserStatus {
    Active = "active",
    Suspended = "suspended",
    Deleted = "deleted"
}

export enum EnrollmentStatus {
    Pending = "pending",
    PaymentPending = "payment-pending",
    Active = "active",
    Completed = "completed",
    Suspended = "suspended",
    Refunded = "refunded",
    PaymentFailed = "payment-failed"
}

export enum BatchStatus {
    Draft = "draft",
    Upcoming = "upcoming",
    Running = "running",
    Completed = "completed"
}

export enum CourseStatus {
    Draft = "draft",
    Published = "published",
    Archived = "archived"
}

export enum CourseLevel {
    Beginner = "beginner",
    Intermediate = "intermediate",
    Advanced = "advanced"
}

export enum LessonType {
    Video = "video",
    Reading = "reading",
    Quiz = "quiz",
    Project = "project"
}

export enum VideoSource {
    YouTube = "youtube",
    GoogleDrive = "googledrive"
}

export enum ResourceType {
    File = "file",
    Link = "link",
    Document = "document"
}

export enum ProgressStatus {
    Locked = "locked",
    Unlocked = "unlocked",
    InProgress = "in-progress",
    Completed = "completed"
}

export enum LessonProgressStatus {
    NotStarted = "not-started",
    InProgress = "in-progress",
    Completed = "completed"
}

export enum SubmissionStatus {
    Submitted = "submitted",
    UnderReview = "under-review",
    RevisionRequested = "revision-requested",
    Approved = "approved",
    Rejected = "rejected"
}

export enum InstructorRole {
    Lead = "lead",
    Assistant = "assistant",
    Guest = "guest"
}

export enum CertificateStatus {
    Pending = "pending",  // Waiting for admin approval
    Active = "active",    // Approved and issued
    Revoked = "revoked"   // Revoked by admin
}
