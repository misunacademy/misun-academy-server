import express from 'express';
import { InstructorController } from './instructor.controller.js';
import { requireAuth, requireInstructor } from '../../middlewares/betterAuth.js';

const router = express.Router();

// Instructor profile
router.get(
    '/profile',
    requireAuth,
    requireInstructor,
    InstructorController.getProfile
);

router.put(
    '/profile',
    requireAuth,
    requireInstructor,
    InstructorController.updateProfile
);

// Dashboard
router.get(
    '/dashboard',
    requireAuth,
    requireInstructor,
    InstructorController.getDashboard
);

// Batches
router.get(
    '/batches',
    requireAuth,
    requireInstructor,
    InstructorController.getAssignedBatches
);

router.get(
    '/batches/:batchId/students',
    requireAuth,
    requireInstructor,
    InstructorController.getBatchStudents
);

router.get(
    '/batches/:batchId/statistics',
    requireAuth,
    requireInstructor,
    InstructorController.getBatchStatistics
);



export const InstructorRoutes = router;
