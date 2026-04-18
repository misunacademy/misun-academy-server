import express from 'express';
import { SettingsController } from './settings.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { SettingsValidation } from './settings.validation.js';

const router = express.Router();

router.get('/', SettingsController.getSettings);

router.patch(
  '/',
  requireAuth,
  requireAdmin,
  validateRequest(SettingsValidation.updateSettings),
  SettingsController.updateSettings
);

export const SettingsRoutes = router;