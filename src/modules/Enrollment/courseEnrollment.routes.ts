import express from 'express';
import { requireAuth } from '../../middlewares/betterAuth';
import { CourseEnrollmentController } from './courseEnrollment.controller';

const router = express.Router();

// All routes require learner authentication
router.use(requireAuth);

// Get course progress
router.get('/:courseId/progress', CourseEnrollmentController.getCourseProgress);

// Complete a lesson
router.post('/:courseId/complete-lesson', CourseEnrollmentController.completeLesson);

export const CourseEnrollmentRoutes = router;