import { Schema, model } from 'mongoose';
import type { INotificationDocument, NotificationType } from './notification.interface.js';

const notificationSchema = new Schema<INotificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'enrollment',
        'recording_published',
        'lesson_published',
        'payment_pending',
        'payment_success',
        'payment_failed',
        'access_granted',
        'quiz_published',
        'quiz_result',
        'certificate_requested',
        'certificate_approved',
        'certificate_issued',
        'certificate_rejected',
        'course_published',
        'instructor_assigned',
        'batch_status_changed',
        'batch_updated',
        'batch_start_reminder',
        'user_registered',
        'email_verified',
        'user_status_changed',
        'course_completed',
        'module_completed',
        'new_announcement',
      ] satisfies NotificationType[],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    link: {
      type: String,
    },
    relatedTo: {
      model: { type: String },
      id: { type: Schema.Types.ObjectId },
    },
    read: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isDeleted: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export const NotificationModel = model<INotificationDocument>(
  'Notification',
  notificationSchema
);
