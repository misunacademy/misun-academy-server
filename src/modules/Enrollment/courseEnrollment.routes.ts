import express from 'express';
import { requireAuth } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { completeLessonSchema } from '../../validations/courseEnrollment.validation.js';
import { CourseEnrollmentController } from './courseEnrollment.controller.js';

const router = express.Router();

// All routes require learner authentication
router.use(requireAuth);

// Get course progress
router.get('/:courseId/progress', CourseEnrollmentController.getCourseProgress);

// Complete a lesson
router.post('/:courseId/complete-lesson', validateRequest(completeLessonSchema), CourseEnrollmentController.completeLesson);

export const CourseEnrollmentRoutes = router;