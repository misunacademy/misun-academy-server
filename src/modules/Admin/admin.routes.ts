import express from 'express';
import validateRequest from '../../middlewares/validateRequest.js';
import { loginValidationSchema, sendNewsUpdateSchema, sendBatchProgressReminderSchema, sendBatchIncompleteReminderSchema } from './admin.validation.js';
import { AdminAuthController } from './admin.controller.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middlewares/betterAuth.js';


const router = express.Router();

// Admin login (public)
router.post(
    '/auth',
    validateRequest(loginValidationSchema),
    AdminAuthController.loginUser
);

// User management (protected routes)
router.get(
    '/users',
    requireAuth,
    requireAdmin,
    AdminAuthController.getAllUsers
);

router.get(
    '/users/:id',
    requireAuth,
    requireAdmin,
    AdminAuthController.getUserById
);

router.post(
    '/users',
    requireAuth,
    requireAdmin,  // Admin can create instructors/employees
    AdminAuthController.createAdmin
);

router.put(
    '/users/:id',
    requireAuth,
    requireAdmin,
    AdminAuthController.updateUser
);

router.patch(
    '/users/:id/status',
    requireAuth,
    requireAdmin,  // Both can suspend users
    AdminAuthController.updateUserStatus
);

router.delete(
    '/users/:id',
    requireAuth,
    requireAdmin,  // Only SuperAdmin can delete
    AdminAuthController.deleteUser
);

// Email management routes
router.post(
    '/send-enrollment-reminder',
    requireAuth,
    requireAdmin,
    AdminAuthController.sendEnrollmentReminder
);

router.post(
    '/send-news-update',
    requireAuth,
    requireAdmin,
    validateRequest(sendNewsUpdateSchema),
    AdminAuthController.sendNewsUpdate
);

router.post(
    '/send-batch-progress-reminder',
    requireAuth,
    requireAdmin,
    validateRequest(sendBatchProgressReminderSchema),
    AdminAuthController.sendRunningBatchProgressReminder
);

router.post(
    '/send-batch-incomplete-reminder',
    requireAuth,
    requireAdmin,
    validateRequest(sendBatchIncompleteReminderSchema),
    AdminAuthController.sendCompletedBatchIncompleteReminder
);

// Get all active instructor profiles (for batch assignment)
router.get(
    '/instructors',
    requireAuth,
    requireAdmin,
    AdminAuthController.getAllInstructors
);

export const AdminAuthRoutes = router;
