import express from 'express';
import { InstructorController } from './instructor.controller.js';
import { requireAuth, requireInstructor } from '../../middlewares/betterAuth.js';

const router = express.Router();

// All routes below require auth + instructor role
router.use(requireAuth, requireInstructor);

// ── Profile ──────────────────────────────────────────────────────────────────
router.get('/profile', InstructorController.getProfile);
router.put('/profile', InstructorController.updateProfile);


// ── Batches ──────────────────────────────────────────────────────────────────
router.get('/batches', InstructorController.getCoursesWithBatches);
router.get('/batches/:batchId/students', InstructorController.getBatchStudents);
router.get('/batches/:batchId/statistics', InstructorController.getBatchStatistics);

// ── Assigned Courses (scoped content management) ─────────────────────────────
router.get('/students', InstructorController.getInstructorEnrolledStudents);
router.get('/courses', InstructorController.getAssignedCourses);

// Module CRUD — only for assigned courses
router.get('/courses/:courseId/modules', InstructorController.getCourseModules);
router.post('/courses/:courseId/modules', InstructorController.createCourseModule);
router.put('/courses/:courseId/modules/reorder', InstructorController.reorderCourseModules);
router.put('/modules/:moduleId', InstructorController.updateCourseModule);
router.delete('/modules/:moduleId', InstructorController.deleteCourseModule);

// Lesson CRUD — only for modules inside assigned courses
router.get('/modules/:moduleId/lessons', InstructorController.getModuleLessons);
router.post('/modules/:moduleId/lessons', InstructorController.createModuleLesson);
router.put('/lessons/:lessonId', InstructorController.updateModuleLesson);
router.delete('/lessons/:lessonId', InstructorController.deleteModuleLesson);

export const InstructorRoutes = router;
