import express from 'express';
import { CourseController } from './course.controller';
import { requireAuth, requireSuperAdmin, requireInstructor, requireRole } from '../../middlewares/betterAuth';
import { Role } from '../../types/role';

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
    CourseController.createCourse
);

router.put(
    '/:id',
    requireAuth,
    requireInstructor,
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
