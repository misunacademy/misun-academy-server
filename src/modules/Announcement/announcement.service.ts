import { FilterQuery, Types } from 'mongoose';
import { AnnouncementModel } from './announcement.model.js';
import {
  AnnouncementAudience,
  AnnouncementStatus,
  AnnouncementType,
  IAnnouncement,
} from './announcement.interface.js';
import { UserModel } from '../User/user.model.js';
import { recordAudit } from '../../models/auditLog.model.js';
import { NotificationModel } from '../Notification/notification.model.js';
import { sendAnnouncementEmail } from '../../services/misunAcademyEmails.js';
import env from '../../config/env.js';

interface CreateAnnouncementPayload {
  title: string;
  message: string;
  type?: AnnouncementType;
  audience?: AnnouncementAudience;
  status?: AnnouncementStatus;
  link?: string;
  isDismissible?: boolean;
  notifyByEmail?: boolean;
  publishAt?: string;
  expireAt?: string;
}

interface UpdateAnnouncementPayload {
  title?: string;
  message?: string;
  type?: AnnouncementType;
  audience?: AnnouncementAudience;
  status?: AnnouncementStatus;
  link?: string;
  isDismissible?: boolean;
  notifyByEmail?: boolean;
  publishAt?: string;
  expireAt?: string;
}

interface ListQuery {
  status?: AnnouncementStatus;
  audience?: AnnouncementAudience;
  search?: string;
  page?: number;
  limit?: number;
}

const toDate = (value?: string | null): Date | undefined => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const normalizePayload = (payload: CreateAnnouncementPayload | UpdateAnnouncementPayload) => {
  const out: Record<string, unknown> = {};
  if (payload.title !== undefined) out.title = payload.title;
  if (payload.message !== undefined) out.message = payload.message;
  if (payload.type !== undefined) out.type = payload.type;
  if (payload.audience !== undefined) out.audience = payload.audience;
  if (payload.status !== undefined) out.status = payload.status;
  if (payload.link !== undefined) out.link = payload.link || undefined;
  if (payload.isDismissible !== undefined) out.isDismissible = payload.isDismissible;
  if (payload.notifyByEmail !== undefined) out.notifyByEmail = payload.notifyByEmail;
  const pub = toDate(payload.publishAt);
  if (pub) out.publishAt = pub;
  if (payload.publishAt === '' || payload.publishAt === null) out.publishAt = null;
  const exp = toDate(payload.expireAt);
  if (exp) out.expireAt = exp;
  if (payload.expireAt === '' || payload.expireAt === null) out.expireAt = null;
  return out;
};

const isLiveNow = (doc: { status?: string; publishAt?: Date | null; expireAt?: Date | null }) => {
  if (doc.status !== AnnouncementStatus.Published) return false;
  const now = new Date();
  if (doc.publishAt && doc.publishAt > now) return false;
  if (doc.expireAt && doc.expireAt < now) return false;
  return true;
};

const audienceRoleMap: Record<AnnouncementAudience, string | null> = {
  [AnnouncementAudience.All]: null,
  [AnnouncementAudience.Learner]: 'learner',
  [AnnouncementAudience.Instructor]: 'instructor',
  [AnnouncementAudience.Employee]: 'employee',
  [AnnouncementAudience.Admin]: 'admin',
};

const buildCtaUrl = (link?: string | null): string => {
  if (!link) return `${env.MA_FRONTEND_URL}/dashboard/notifications`;
  if (/^https?:\/\//i.test(link)) return link;
  return `${env.MA_FRONTEND_URL}${link.startsWith('/') ? '' : '/'}${link}`;
};

const createAnnouncement = async (
  payload: CreateAnnouncementPayload,
  actor: { id: string; role?: string },
  ip?: string
) => {
  const data = normalizePayload(payload);
  const status = (data.status as AnnouncementStatus) || AnnouncementStatus.Draft;

  const announcement = await AnnouncementModel.create({
    ...data,
    status,
    createdBy: new Types.ObjectId(actor.id),
  });

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'announcement.create',
    targetType: 'Announcement',
    targetId: announcement._id.toString(),
    metadata: { status, audience: announcement.audience, type: announcement.type },
    ip,
  });

  return announcement;
};

const listAnnouncements = async (params: ListQuery) => {
  const { status, audience, search, page = 1, limit = 10 } = params;

  const query: FilterQuery<IAnnouncement> = {};
  if (status) query.status = status;
  if (audience) query.audience = audience;
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(safe, 'i');
    query.$or = [{ title: re }, { message: re }];
  }

  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.max(1, limit || 10);
  const skip = (safePage - 1) * safeLimit;

  const [total, items] = await Promise.all([
    AnnouncementModel.countDocuments(query),
    AnnouncementModel.find(query)
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  return {
    data: items,
    meta: { total, page: safePage, limit: safeLimit, totalPages: Math.max(1, Math.ceil(total / safeLimit)) },
  };
};

const getAnnouncementById = async (id: string) => {
  const a = await AnnouncementModel.findById(id).populate('createdBy', 'name email role').lean();
  if (!a) return null;
  return a;
};

const updateAnnouncement = async (
  id: string,
  payload: UpdateAnnouncementPayload,
  actor: { id: string; role?: string },
  ip?: string
) => {
  const before = await AnnouncementModel.findById(id).lean();
  if (!before) return null;

  const data = normalizePayload(payload);
  const updated = await AnnouncementModel.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  })
    .populate('createdBy', 'name email role')
    .lean();

  if (updated) {
    await recordAudit({
      actor: actor.id,
      actorRole: actor.role,
      action: 'announcement.update',
      targetType: 'Announcement',
      targetId: id,
      metadata: {
        changedFields: Object.keys(data),
        beforeStatus: before.status,
        afterStatus: updated.status,
      },
      ip,
    });
  }

  return updated;
};

const deleteAnnouncement = async (
  id: string,
  actor: { id: string; role?: string },
  ip?: string
) => {
  const a = await AnnouncementModel.findByIdAndDelete(id).lean();
  if (!a) return null;

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'announcement.delete',
    targetType: 'Announcement',
    targetId: id,
    metadata: { title: a.title, audience: a.audience },
    ip,
  });

  return a;
};

const publishAnnouncement = async (
  id: string,
  actor: { id: string; role?: string },
  ip?: string
) => {
  const before = await AnnouncementModel.findById(id);
  if (!before) return null;

  before.status = AnnouncementStatus.Published;
  before.publishAt = new Date();
  await before.save();

  const audience = before.audience;
  const roleFilter = audienceRoleMap[audience];
  const userQuery: FilterQuery<typeof UserModel> = { status: 'active' };
  if (roleFilter) userQuery.role = roleFilter;

  const targetUsers = await UserModel.find(userQuery).select('_id email name').lean();
  const link = before.link || '/dashboard/notifications';

  if (targetUsers.length > 0) {
    const notifications = targetUsers.map((u) => ({
      userId: u._id,
      type: 'new_announcement' as const,
      title: before.title,
      message: before.message,
      link,
    }));
    try {
      await NotificationModel.insertMany(notifications, { ordered: false });
    } catch {
      // best-effort; do not block publish on notification failure
    }

    if (before.notifyByEmail) {
      const ctaUrl = buildCtaUrl(before.link);
      const announcementId = (before._id as Types.ObjectId).toString();
      await Promise.allSettled(
        targetUsers
          .filter((u) => Boolean(u.email))
          .map((u) =>
            sendAnnouncementEmail(
              u.email,
              u.name,
              before.title,
              before.message,
              ctaUrl,
              `${announcementId}:${(u._id as Types.ObjectId).toString()}`
            )
          )
      );
    }
  }

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'announcement.publish',
    targetType: 'Announcement',
    targetId: id,
    metadata: { audience, notified: targetUsers.length },
    ip,
  });

  return before.toObject();
};

const getLiveAnnouncements = async (audience?: string, limit = 5) => {
  const now = new Date();
  const query: FilterQuery<IAnnouncement> = {
    status: AnnouncementStatus.Published,
    $and: [
      { $or: [{ publishAt: { $exists: false } }, { publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ expireAt: { $exists: false } }, { expireAt: null }, { expireAt: { $gte: now } }] },
    ],
  };
  if (audience && audience !== 'all') {
    query.audience = { $in: [audience, 'all'] };
  } else {
    query.audience = 'all';
  }
  return AnnouncementModel.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(50, limit)))
    .lean();
};

const getAnnouncementStats = async () => {
  const [total, draft, published, scheduled, expired, byAudience, byType] = await Promise.all([
    AnnouncementModel.countDocuments(),
    AnnouncementModel.countDocuments({ status: AnnouncementStatus.Draft }),
    AnnouncementModel.countDocuments({ status: AnnouncementStatus.Published }),
    AnnouncementModel.countDocuments({ status: AnnouncementStatus.Scheduled }),
    AnnouncementModel.countDocuments({ status: AnnouncementStatus.Expired }),
    AnnouncementModel.aggregate([{ $group: { _id: '$audience', count: { $sum: 1 } } }]),
    AnnouncementModel.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
  ]);

  const audienceMap: Record<string, number> = {};
  byAudience.forEach((b: any) => { if (b._id) audienceMap[b._id] = b.count; });
  const typeMap: Record<string, number> = {};
  byType.forEach((b: any) => { if (b._id) typeMap[b._id] = b.count; });

  return { total, draft, published, scheduled, expired, byAudience: audienceMap, byType: typeMap };
};

export const AnnouncementService = {
  createAnnouncement,
  listAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  getLiveAnnouncements,
  getAnnouncementStats,
  isLiveNow,
};
