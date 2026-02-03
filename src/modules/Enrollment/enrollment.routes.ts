import express from 'express';
import { EnrollmentController } from './enrollment.controller';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth';

const router = express.Router();

// Learner routes
router.post(
    '/',
    requireAuth,
    EnrollmentController.initiateEnrollment
);

router.post(
    '/manual',
    requireAuth,
    EnrollmentController.enrollWithManualPayment
);

router.get(
    '/me',
    requireAuth,
    EnrollmentController.getMyEnrollments
);

router.get(
    '/:enrollmentId',
    requireAuth,
    EnrollmentController.getEnrollmentDetails
);

// Admin routes
router.get(
    '/',
    requireAuth,
    requireAdmin,
    EnrollmentController.getAllEnrollments
);

router.put(
    '/:enrollmentId/status',
    requireAuth,
    requireAdmin,
    EnrollmentController.updateEnrollmentStatus
);

export const EnrollmentRoutes = router;
