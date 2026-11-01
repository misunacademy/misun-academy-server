import { Schema, model } from 'mongoose';
import { AnnouncementAudience, AnnouncementStatus, AnnouncementType, IAnnouncement } from './announcement.interface.js';

const announcementSchema = new Schema<IAnnouncement>(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    type: { type: String, enum: Object.values(AnnouncementType), default: AnnouncementType.Info, index: true },
    audience: { type: String, enum: Object.values(AnnouncementAudience), default: AnnouncementAudience.All, index: true },
    status: { type: String, enum: Object.values(AnnouncementStatus), default: AnnouncementStatus.Draft, index: true },
    link: { type: String, trim: true, maxlength: 2048 },
    isDismissible: { type: Boolean, default: true },
    notifyByEmail: { type: Boolean, default: false },
    publishAt: { type: Date },
    expireAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

announcementSchema.index({ status: 1, publishAt: 1, expireAt: 1 });
announcementSchema.index({ createdAt: -1 });

export const AnnouncementModel = model<IAnnouncement>('Announcement', announcementSchema);
