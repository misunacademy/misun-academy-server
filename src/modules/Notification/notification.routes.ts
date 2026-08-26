import express from 'express';
import { requireAuth } from '../../middlewares/betterAuth.js';
import { NotificationController } from './notification.controller.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', NotificationController.getNotifications);

router.get('/unread-count', NotificationController.getUnreadCount);

router.put('/read-all', NotificationController.markAllAsRead);

router.put('/:notificationId/read', NotificationController.markAsRead);

router.delete('/delete-all', NotificationController.deleteAllNotifications);

router.delete('/:notificationId', NotificationController.deleteNotification);

export const NotificationRoutes = router;
