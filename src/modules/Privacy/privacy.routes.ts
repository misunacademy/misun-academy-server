import express from 'express';
import { requireAuth } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { PrivacyController } from './privacy.controller.js';
import { deleteUserSchema } from '../Admin/admin.validation.js';
import { consentSchema } from './privacy.validation.js';

const router = express.Router();

// All privacy routes require learner authentication
router.use(requireAuth);

// Self-service data export (GDPR data portability)
router.get(
    '/me/export',
    PrivacyController.exportMyData
);

// Self-service account deletion (soft-delete + anonymize PII)
router.delete(
    '/me/account',
    validateRequest(deleteUserSchema),
    PrivacyController.deleteMyAccount
);

// Consent tracking
router.post(
    '/me/consent',
    validateRequest(consentSchema),
    PrivacyController.recordConsent
);

// Get all consents for the authenticated user
router.get(
    '/me/consent',
    PrivacyController.getMyConsents
);

export const PrivacyRoutes = router;
