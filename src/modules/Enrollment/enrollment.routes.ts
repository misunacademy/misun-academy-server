import express from 'express';
import { EnrollmentController } from './enrollment.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createRateLimiter } from '../../middlewares/rateLimit.js';
import { initiateEnrollmentSchema, manualEnrollmentSchema, grantAccessSchema, updateEnrollmentStatusSchema } from '../../validations/enrollment.validation.js';

const router = express.Router();

const manualEnrollmentLimiter = createRateLimiter({
    prefix: 'enroll-manual',
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyByUser: true,
    message: 'Too many manual payment submissions. Please try again later.',
});

// Learner routes
router.post(
    '/',
    requireAuth,
    validateRequest(initiateEnrollmentSchema),
    EnrollmentController.initiateEnrollment
);

router.post(
    '/manual',
    requireAuth,
    manualEnrollmentLimiter,
    validateRequest(manualEnrollmentSchema),
    EnrollmentController.enrollWithManualPayment
);

router.post(
    '/grant-access',
    requireAuth,
    requireAdmin,
    validateRequest(grantAccessSchema),
    EnrollmentController.grantAccessByEmail
);

router.get(
    '/me',
    requireAuth,
    EnrollmentController.getMyEnrollments
);

router.get(
    '/special-access',
    requireAuth,
    requireAdmin,
    EnrollmentController.getSpecialAccessEnrollments
);

// Admin routes — must be before parameterized routes
router.get(
    '/',
    requireAuth,
    requireAdmin,
    EnrollmentController.getAllEnrollments
);

router.get(
    '/:enrollmentId',
    requireAuth,
    EnrollmentController.getEnrollmentDetails
);

router.put(
    '/:enrollmentId/status',
    requireAuth,
    requireAdmin,
    validateRequest(updateEnrollmentStatusSchema),
    EnrollmentController.updateEnrollmentStatus
);

export const EnrollmentRoutes = router;
