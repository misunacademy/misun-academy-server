import express from 'express';
import validateRequest from '../../middlewares/validateRequest';
import { loginValidationSchema, sendNewsUpdateSchema } from './admin.validation';
import { AdminAuthController } from './admin.controller';
import { requireAuth, requireAdmin, requireSuperAdmin, requireRole } from '../../middlewares/betterAuth';
import { Role } from '../../types/role';

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
    requireSuperAdmin,  // Only SuperAdmin can create new admins
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
    requireSuperAdmin,  // Only SuperAdmin can delete
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

export const AdminAuthRoutes = router;
