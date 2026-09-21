import { Types } from 'mongoose';

export enum AnnouncementAudience {
  All = 'all',
  Learner = 'learner',
  Instructor = 'instructor',
  Employee = 'employee',
  Admin = 'admin',
}

export enum AnnouncementType {
  Info = 'info',
  Success = 'success',
  Warning = 'warning',
  Critical = 'critical',
}

export enum AnnouncementStatus {
  Draft = 'draft',
  Published = 'published',
  Scheduled = 'scheduled',
  Expired = 'expired',
  // Taken down after being live: hidden from users but kept for records
  // (unlike delete). Only reachable from published/scheduled.
  Unpublished = 'unpublished',
}

export interface IAnnouncement {
  title: string;
  message: string;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  status: AnnouncementStatus;
  link?: string;
  isDismissible: boolean;
  notifyByEmail: boolean;
  publishAt?: Date;
  expireAt?: Date;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}
