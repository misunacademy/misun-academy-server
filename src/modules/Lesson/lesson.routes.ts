import express from 'express';
import { LessonController } from './lesson.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createLessonSchema, updateLessonSchema, reorderLessonsSchema } from '../../validations/lesson.validation.js';

const router = express.Router();

// All routes require learner authentication
router.use(requireAuth);

// Admin-only routes
router.post('/modules/:moduleId/lessons', requireAdmin, validateRequest(createLessonSchema), LessonController.createLesson);
router.put('/modules/:moduleId/lessons/reorder', requireAdmin, validateRequest(reorderLessonsSchema), LessonController.reorderLessons);
router.put('/lessons/:lessonId', requireAdmin, validateRequest(updateLessonSchema), LessonController.updateLesson);
router.delete('/lessons/:lessonId', requireAdmin, LessonController.deleteLesson);

// Get all lessons for a module (learner-authenticated)
router.get('/modules/:moduleId/lessons', LessonController.getModuleLessons);

// Get lesson by ID (learner-authenticated)
router.get('/lessons/:lessonId', LessonController.getLessonById);

// Generate signed video URL — learner-authenticated (enrollment-checked in service)
router.get('/lessons/:lessonId/signed-url', LessonController.generateSignedVideoUrl);

export const LessonRoutes = router;
