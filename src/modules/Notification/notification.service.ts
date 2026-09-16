import { NotificationModel } from './notification.model.js';
import type { NotificationType } from './notification.interface.js';
import { UserModel } from '../User/user.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { Role } from '../../types/role.js';
import { EnrollmentStatus } from '../../types/common.js';
import { getIO } from '../../services/socketService.js';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  relatedTo?: { model: string; id: string };
}

const buildNotifData = (params: CreateNotificationParams | Omit<CreateNotificationParams, 'userId'> & { userId?: string }) => ({
  type: params.type,
  title: params.title,
  message: params.message,
  link: params.link,
  relatedTo: params.relatedTo
    ? { model: params.relatedTo.model, id: params.relatedTo.id }
    : undefined,
});

const createNotification = async (params: CreateNotificationParams) => {
  const notification = await NotificationModel.create({
    userId: params.userId,
    ...buildNotifData(params),
  });

  const io = getIO();
  if (io) {
    io.to(`user:${params.userId}`).emit('notification', notification.toObject());
  }

  return notification;
};

const createNotificationForAdmins = async (params: Omit<CreateNotificationParams, 'userId'>) => {
  const admins = await UserModel.find({
    role: { $in: [Role.ADMIN, Role.SUPERADMIN] },
    status: 'active',
  }).select('_id').lean();

  if (admins.length === 0) return [];

  const notifications = await NotificationModel.insertMany(
    admins.map((admin) => ({
      userId: admin._id,
      ...buildNotifData(params),
    }))
  );

  const io = getIO();
  if (io) {
    const notifByUser = new Map(
      notifications.map((n) => [n.userId.toString(), n])
    );
    for (const admin of admins) {
      const notif = notifByUser.get(admin._id.toString());
      if (notif) {
        io.to(`user:${admin._id}`).emit('notification', notif.toObject());
      }
    }
  }

  return notifications;
};

const createBatchNotification = async (
  batchId: string,
  params: Omit<CreateNotificationParams, 'userId'>,
  excludeUserId?: string
) => {
  const enrollments = await EnrollmentModel.find({
    batchId,
    status: EnrollmentStatus.Active,
  }).select('userId').lean();

  const userIds = [
    ...new Set(enrollments.map((e) => e.userId.toString())),
  ].filter((id) => id !== excludeUserId);

  if (userIds.length === 0) return [];

  const notifications = await NotificationModel.insertMany(
    userIds.map((userId) => ({
      userId,
      ...buildNotifData(params),
    }))
  );

  const io = getIO();
  if (io) {
    const notifByUser = new Map(
      notifications.map((n) => [n.userId.toString(), n])
    );
    for (const userId of userIds) {
      const notif = notifByUser.get(userId);
      if (notif) {
        io.to(`user:${userId}`).emit('notification', notif.toObject());
      }
    }
  }

  return notifications;
};

const getUserNotifications = async (
  userId: string,
  query: { page?: number; limit?: number; read?: boolean }
) => {
  const page = query.page || 1;
  const limit = query.limit || 10;
  const filter: any = { userId, isDeleted: { $ne: true } };
  if (query.read !== undefined) filter.read = query.read;

  const [data, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationModel.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getUnreadCount = async (userId: string) => {
  return NotificationModel.countDocuments({ userId, read: false, isDeleted: { $ne: true } });
};

const markAsRead = async (userId: string, notificationId: string) => {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: notificationId, userId },
    { read: true },
    { new: true }
  );
  return notification;
};

const markAllAsRead = async (userId: string) => {
  const result = await NotificationModel.updateMany(
    { userId, read: false, isDeleted: { $ne: true } },
    { read: true }
  );
  return result;
};

const deleteNotification = async (userId: string, notificationId: string) => {
  const notification = await NotificationModel.findOneAndUpdate(
    { _id: notificationId, userId },
    { isDeleted: true, deletedAt: new Date() },
    { new: true }
  );
  return notification;
};

const deleteAllNotifications = async (userId: string) => {
  const result = await NotificationModel.updateMany(
    { userId, isDeleted: { $ne: true } },
    { isDeleted: true, deletedAt: new Date() }
  );
  return result;
};

export const NotificationService = {
  createNotification,
  createNotificationForAdmins,
  createBatchNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
};
