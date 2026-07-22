import express from 'express';
import { LessonController } from './lesson.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createLessonSchema, updateLessonSchema, reorderLessonsSchema } from '../../validations/lesson.validation.js';

const router = express.Router();

// All routes require admin authentication
router.use(requireAuth);
router.use(requireAdmin);

// Create lesson for a module
router.post('/modules/:moduleId/lessons', validateRequest(createLessonSchema), LessonController.createLesson);

// Get all lessons for a module
router.get('/modules/:moduleId/lessons', LessonController.getModuleLessons);

// Reorder lessons
router.put('/modules/:moduleId/lessons/reorder', validateRequest(reorderLessonsSchema), LessonController.reorderLessons);

// Get lesson by ID
router.get('/lessons/:lessonId', LessonController.getLessonById);

// Update lesson
router.put('/lessons/:lessonId', validateRequest(updateLessonSchema), LessonController.updateLesson);

// Delete lesson
router.delete('/lessons/:lessonId', LessonController.deleteLesson);

export const LessonRoutes = router;
