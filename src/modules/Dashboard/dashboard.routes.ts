import express from 'express';
import { DashboardController } from './dashboard.controller.js';
import { requireAuth, requireAdmin, requireEmployee, requireInstructor } from '../../middlewares/betterAuth.js';

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

// Instructor dashboard route
router.get(
    '/instructor',
    requireAuth,
    requireInstructor,
    DashboardController.getInstructorDashboard
);

export const DashboardRoutes = router;