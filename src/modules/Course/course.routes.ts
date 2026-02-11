import express from 'express';
import { CourseController } from './course.controller';
import { requireAuth, requireAdmin, requireSuperAdmin, requireInstructor, requireRole } from '../../middlewares/betterAuth';
import { Role } from '../../types/role';
import validateRequest from '../../middlewares/validateRequest';
import { createCourseSchema, updateCourseSchema } from '../../validations/course.validation';

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

// Admins and SuperAdmins can delete courses
router.delete(
    '/:id',
    requireAuth,
    requireAdmin,
    CourseController.deleteCourse
);

export const CourseRoutes = router;
