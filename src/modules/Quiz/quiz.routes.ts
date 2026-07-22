import express from 'express';
import { QuizController } from './quiz.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createQuizSchema, updateQuizSchema, reorderQuizzesSchema } from '../../validations/quiz.validation.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', QuizController.getAllQuizzes);
router.post('/modules/:moduleId/quizzes', validateRequest(createQuizSchema), QuizController.createQuiz);
router.get('/modules/:moduleId/quizzes', QuizController.getModuleQuizzes);
router.put('/modules/:moduleId/quizzes/reorder', validateRequest(reorderQuizzesSchema), QuizController.reorderQuizzes);
router.get('/quizzes/:quizId', QuizController.getQuizById);
router.put('/quizzes/:quizId', validateRequest(updateQuizSchema), QuizController.updateQuiz);
router.delete('/quizzes/:quizId', QuizController.deleteQuiz);

export const QuizRoutes = router;
