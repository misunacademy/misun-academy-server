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
        'access_granted',
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
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const NotificationModel = model<INotificationDocument>(
  'Notification',
  notificationSchema
);
