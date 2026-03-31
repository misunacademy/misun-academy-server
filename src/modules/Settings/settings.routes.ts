import express from 'express';
import { SettingsController } from './settings.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';

const router = express.Router();

router.get('/', SettingsController.getSettings);

router.patch(
  '/',
  requireAuth,
  requireAdmin,
  SettingsController.updateSettings
);

export const SettingsRoutes = router;