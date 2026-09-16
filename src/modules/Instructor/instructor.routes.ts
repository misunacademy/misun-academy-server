import express from 'express';
import { InstructorController } from './instructor.controller.js';
import { requireAuth, requireInstructor } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createModuleSchema, updateModuleSchema, reorderModulesSchema } from '../../validations/module.validation.js';
import { createLessonSchema, updateLessonSchema } from '../../validations/lesson.validation.js';
import { updateInstructorProfileSchema } from '../../validations/instructor.validation.js';
import { createQuizSchema, updateQuizSchema, createQuestionSchema, updateQuestionSchema, reorderQuestionsSchema } from '../../validations/quiz.validation.js';

const router = express.Router();

// All routes below require auth + instructor role
router.use(requireAuth, requireInstructor);

// ── Profile ──────────────────────────────────────────────────────────────────
router.get('/profile', InstructorController.getProfile);
router.put('/profile', validateRequest(updateInstructorProfileSchema), InstructorController.updateProfile);


// ── Batches ──────────────────────────────────────────────────────────────────
router.get('/batches', InstructorController.getCoursesWithBatches);
router.get('/batches/:batchId/students', InstructorController.getBatchStudents);
router.get('/batches/:batchId/statistics', InstructorController.getBatchStatistics);

// ── Assigned Courses (scoped content management) ─────────────────────────────
router.get('/students', InstructorController.getInstructorEnrolledStudents);
router.get('/courses', InstructorController.getAssignedCourses);

// Module CRUD — only for assigned courses
router.get('/courses/:courseId/modules', InstructorController.getCourseModules);
router.post('/courses/:courseId/modules', validateRequest(createModuleSchema), InstructorController.createCourseModule);
router.put('/courses/:courseId/modules/reorder', validateRequest(reorderModulesSchema), InstructorController.reorderCourseModules);
router.put('/modules/:moduleId', validateRequest(updateModuleSchema), InstructorController.updateCourseModule);
router.delete('/modules/:moduleId', InstructorController.deleteCourseModule);

// Lesson CRUD — only for modules inside assigned courses
router.get('/modules/:moduleId/lessons', InstructorController.getModuleLessons);
router.post('/modules/:moduleId/lessons', validateRequest(createLessonSchema), InstructorController.createModuleLesson);
router.put('/lessons/:lessonId', validateRequest(updateLessonSchema), InstructorController.updateModuleLesson);
router.delete('/lessons/:lessonId', InstructorController.deleteModuleLesson);

// Quiz CRUD — only for modules inside assigned courses
router.get('/modules/:moduleId/quizzes', InstructorController.getModuleQuizzes);
router.get('/quizzes/:quizId', InstructorController.getQuizById);
router.post('/modules/:moduleId/quizzes', validateRequest(createQuizSchema), InstructorController.createModuleQuiz);
router.put('/quizzes/:quizId', validateRequest(updateQuizSchema), InstructorController.updateModuleQuiz);
router.delete('/quizzes/:quizId', InstructorController.deleteModuleQuiz);

// Quiz analytics
router.get('/quizzes/:quizId/analytics', InstructorController.getQuizAnalytics);

// Question CRUD — only for quizzes inside assigned courses
router.get('/quizzes/:quizId/questions', InstructorController.getQuizQuestions);
router.get('/questions/:questionId', InstructorController.getQuestionById);
router.post('/quizzes/:quizId/questions', validateRequest(createQuestionSchema), InstructorController.createQuestion);
router.put('/quizzes/:quizId/questions/reorder', validateRequest(reorderQuestionsSchema), InstructorController.reorderQuestions);
router.put('/questions/:questionId', validateRequest(updateQuestionSchema), InstructorController.updateQuestion);
router.delete('/questions/:questionId', InstructorController.deleteQuestion);
router.post('/questions/:questionId/duplicate', InstructorController.duplicateQuestion);

export const InstructorRoutes = router;
