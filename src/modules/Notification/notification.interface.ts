import { Types, Document } from 'mongoose';

export type NotificationType =
  | 'enrollment'
  | 'recording_published'
  | 'lesson_published'
  | 'payment_pending'
  | 'access_granted';

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
  createdAt?: Date;
  updatedAt?: Date;
}

export interface INotificationDocument extends Document, INotification {}
