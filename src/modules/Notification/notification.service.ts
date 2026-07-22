import { NotificationModel } from './notification.model.js';
import type { NotificationType } from './notification.interface.js';
import { getIO } from '../../services/socketService.js';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  relatedTo?: { model: string; id: string };
}

const createNotification = async (params: CreateNotificationParams) => {
  const notification = await NotificationModel.create({
    userId: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    link: params.link,
    relatedTo: params.relatedTo
      ? { model: params.relatedTo.model, id: params.relatedTo.id }
      : undefined,
  });

  const io = getIO();
  if (io) {
    io.to(`user:${params.userId}`).emit('notification', notification.toObject());
  }

  return notification;
};

const createNotificationForAdmins = async (params: Omit<CreateNotificationParams, 'userId'>) => {
  const { UserModel } = await import('../User/user.model.js');
  const { Role } = await import('../../types/role.js');

  const admins = await UserModel.find({
    role: { $in: [Role.ADMIN, Role.SUPERADMIN] },
    status: 'active',
  }).select('_id').lean();

  const notifications = await NotificationModel.insertMany(
    admins.map((admin) => ({
      userId: admin._id,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      relatedTo: params.relatedTo
        ? { model: params.relatedTo.model, id: params.relatedTo.id }
        : undefined,
    }))
  );

  const io = getIO();
  if (io) {
    for (const admin of admins) {
      const adminNotification = notifications.find(
        (n) => n.userId.toString() === admin._id.toString()
      );
      if (adminNotification) {
        io.to(`user:${admin._id}`).emit('notification', adminNotification.toObject());
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
  const { EnrollmentModel } = await import('../Enrollment/enrollment.model.js');
  const { EnrollmentStatus } = await import('../../types/common.js');

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
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      relatedTo: params.relatedTo
        ? { model: params.relatedTo.model, id: params.relatedTo.id }
        : undefined,
    }))
  );

  const io = getIO();
  if (io) {
    const notificationByUser = new Map(
      notifications.map((n) => [n.userId.toString(), n])
    );
    for (const userId of userIds) {
      const notif = notificationByUser.get(userId);
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
  const filter: any = { userId };
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
  return NotificationModel.countDocuments({ userId, read: false });
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
    { userId, read: false },
    { read: true }
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
};
