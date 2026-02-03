import express from 'express';
import { DashboardController } from './dashboard.controller';
import { requireAuth, requireAdmin, requireRole } from '../../middlewares/betterAuth';
import { Role } from '../../types/role';

const router = express.Router();

// Admin routes
router.get(
    '/admin',
    requireAuth,
    requireAdmin,
    DashboardController.getAdminDashboard
);

router.get(
    '/users',
    requireAuth,
    requireAdmin,
    DashboardController.getUserStats
);

// Legacy metadata route (60 days stats)
router.get(
    '/metadata',
    requireAuth,
    requireAdmin,
    DashboardController.getDashboardMetaData
);

// Student dashboard route
router.get(
    '/student',
    requireAuth,
    DashboardController.getStudentDashboard
);


export const DashboardRoutes = router;