import express from 'express';
import { QuestionController } from './question.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createQuestionSchema, updateQuestionSchema, reorderQuestionsSchema } from '../../validations/quiz.validation.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

router.post('/quizzes/:quizId/questions', validateRequest(createQuestionSchema), QuestionController.createQuestion);
router.get('/quizzes/:quizId/questions', QuestionController.getQuizQuestions);
router.put('/quizzes/:quizId/questions/reorder', validateRequest(reorderQuestionsSchema), QuestionController.reorderQuestions);
router.get('/questions/:questionId', QuestionController.getQuestionById);
router.put('/questions/:questionId', validateRequest(updateQuestionSchema), QuestionController.updateQuestion);
router.delete('/questions/:questionId', QuestionController.deleteQuestion);
router.post('/questions/:questionId/duplicate', QuestionController.duplicateQuestion);

export const QuestionRoutes = router;
