import express from 'express';
import { CourseController } from './course.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createCourseSchema, updateCourseSchema } from '../../validations/course.validation.js';
import { assignInstructorSchema } from '../../validations/instructor.validation.js';

const router = express.Router();

// Public routes
router.get('/', CourseController.getAllCourses);
router.get('/slug/:slug', CourseController.getCourseBySlug);
router.get('/:id', CourseController.getCourseById);

// Admin routes (only Admins and SuperAdmins can create and edit courses)
router.post(
    '/',
    requireAuth,
    requireAdmin,
    validateRequest(createCourseSchema),
    CourseController.createCourse
);

router.put(
    '/:id',
    requireAuth,
    requireAdmin,
    validateRequest(updateCourseSchema),
    CourseController.updateCourse
);

// Admin: assign one instructor to a course (or unassign by passing instructorId: null)
router.patch(
    '/:id/instructor',
    requireAuth,
    requireAdmin,
    validateRequest(assignInstructorSchema),
    CourseController.assignInstructor
);

// Admins and SuperAdmins can delete courses
router.delete(
    '/:id',
    requireAuth,
    requireAdmin,
    CourseController.deleteCourse
);

export const CourseRoutes = router;
