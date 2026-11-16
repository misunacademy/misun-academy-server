import express from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { EnrollmentPerkController } from './enrollmentPerk.controller.js';
import {
    createPerkRuleSchema,
    listPerkGrantsQuerySchema,
    listPerkRulesQuerySchema,
    perkRuleIdParamSchema,
    toggleRuleStatusSchema,
    updatePerkRuleSchema,
} from './enrollmentPerk.validation.js';

const router = express.Router();

// All perk rule routes require Admin or SuperAdmin role
router.use(requireAuth, requireAdmin);

// Grant audit logs endpoint (must come before /:id)
router.get(
    '/grants/logs',
    validateRequest(listPerkGrantsQuerySchema),
    EnrollmentPerkController.listGrantLogs
);

// Rules CRUD
router.post(
    '/',
    validateRequest(createPerkRuleSchema),
    EnrollmentPerkController.createRule
);

router.get(
    '/',
    validateRequest(listPerkRulesQuerySchema),
    EnrollmentPerkController.listRules
);

router.get(
    '/:id',
    validateRequest(perkRuleIdParamSchema),
    EnrollmentPerkController.getRuleById
);

router.patch(
    '/:id',
    validateRequest(updatePerkRuleSchema),
    EnrollmentPerkController.updateRule
);

router.patch(
    '/:id/status',
    validateRequest(toggleRuleStatusSchema),
    EnrollmentPerkController.toggleRuleStatus
);

router.delete(
    '/:id',
    validateRequest(perkRuleIdParamSchema),
    EnrollmentPerkController.deleteRule
);

// Backfill endpoints
router.get(
    '/:id/backfill-preview',
    validateRequest(perkRuleIdParamSchema),
    EnrollmentPerkController.previewBackfill
);

router.post(
    '/:id/backfill',
    validateRequest(perkRuleIdParamSchema),
    EnrollmentPerkController.executeBackfill
);

export const EnrollmentPerkRoutes = router;
