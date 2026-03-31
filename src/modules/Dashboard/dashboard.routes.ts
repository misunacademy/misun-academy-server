import express from 'express';
import { DashboardController } from './dashboard.controller.js';
import { requireAuth, requireAdmin, requireEmployee } from '../../middlewares/betterAuth.js';
// import { Role } from '../../types/role.js';

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


// Employee dashboard route
// router.get(
//     '/employee',
//     requireAuth,
//     requireEmployee,
//     DashboardController.getEmployeeDashboard
// );

export const DashboardRoutes = router;