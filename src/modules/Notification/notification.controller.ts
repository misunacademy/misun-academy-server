import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { NotificationService } from './notification.service.js';

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.user!;
  const { page, limit, read } = req.query;

  const result = await NotificationService.getUserNotifications(id, {
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 10,
    read: read !== undefined ? read === 'true' : undefined,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notifications retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.user!;
  const count = await NotificationService.getUnreadCount(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Unread count retrieved successfully',
    data: { count },
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.user!;
  const { notificationId } = req.params;

  const notification = await NotificationService.markAsRead(id, notificationId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Notification marked as read',
    data: notification,
  });
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.user!;
  await NotificationService.markAllAsRead(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'All notifications marked as read',
        data: null,
    });
});

export const NotificationController = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
