import { Types, Document } from 'mongoose';

export type NotificationType =
  | 'enrollment'
  | 'recording_published'
  | 'lesson_published'
  | 'payment_pending'
  | 'payment_success'
  | 'payment_failed'
  | 'access_granted'
  | 'quiz_published'
  | 'quiz_result'
  | 'certificate_requested'
  | 'certificate_approved'
  | 'certificate_issued'
  | 'certificate_rejected'
  | 'course_published'
  | 'instructor_assigned'
  | 'batch_status_changed'
  | 'batch_updated'
  | 'batch_start_reminder'
  | 'user_registered'
  | 'email_verified'
  | 'user_status_changed'
  | 'course_completed'
  | 'module_completed'
  | 'new_announcement';

export interface INotification {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  relatedTo?: {
    model: string;
    id: Types.ObjectId;
  };
  read: boolean;
  isDeleted?: boolean;
  deletedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface INotificationDocument extends Document, INotification {}
