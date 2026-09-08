import express from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  announcementIdParamSchema,
  announcementQuerySchema,
} from './announcement.validation.js';
import { AnnouncementController } from './announcement.controller.js';

const router = express.Router();

// Public: live announcements for a role (guests receive audience "all")
router.get('/live', AnnouncementController.getLiveAnnouncements);

// Public metadata (types/audiences/statuses) for UI
router.get('/meta', AnnouncementController.getAnnouncementMeta);

// Admin: stats
router.get('/stats', requireAuth, requireAdmin, AnnouncementController.getAnnouncementStats);

// Admin: list
router.get(
  '/',
  requireAuth,
  requireAdmin,
  validateRequest(announcementQuerySchema),
  AnnouncementController.listAnnouncements
);

// Admin: create
router.post(
  '/',
  requireAuth,
  requireAdmin,
  validateRequest(createAnnouncementSchema),
  AnnouncementController.createAnnouncement
);

// Admin: single
router.get(
  '/:id',
  requireAuth,
  requireAdmin,
  validateRequest(announcementIdParamSchema),
  AnnouncementController.getAnnouncementById
);

// Admin: update
router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  validateRequest(updateAnnouncementSchema),
  AnnouncementController.updateAnnouncement
);

// Admin: publish
router.post(
  '/:id/publish',
  requireAuth,
  requireAdmin,
  validateRequest(announcementIdParamSchema),
  AnnouncementController.publishAnnouncement
);

// Admin: delete
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validateRequest(announcementIdParamSchema),
  AnnouncementController.deleteAnnouncement
);

export const AnnouncementRoutes = router;