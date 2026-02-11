import express from 'express';
import { CourseController } from './course.controller';
import { requireAuth, requireSuperAdmin, requireInstructor, requireRole } from '../../middlewares/betterAuth';
import { Role } from '../../types/role';
import validateRequest from '../../middlewares/validateRequest';
import { createCourseSchema, updateCourseSchema } from '../../validations/course.validation';

const router = express.Router();

// Public routes
router.get('/', CourseController.getAllCourses);
router.get('/slug/:slug', CourseController.getCourseBySlug);
router.get('/:id', CourseController.getCourseById);

// Admin and Lead Instructor routes (instructors can edit courses they teach)
router.post(
    '/',
    requireAuth,
    requireInstructor,
    validateRequest(createCourseSchema),
    CourseController.createCourse
);

router.put(
    '/:id',
    requireAuth,
    requireInstructor,
    validateRequest(updateCourseSchema),
    CourseController.updateCourse
);

// Only SuperAdmins can delete courses
router.delete(
    '/:id',
    requireAuth,
    requireSuperAdmin,
    CourseController.deleteCourse
);

export const CourseRoutes = router;
