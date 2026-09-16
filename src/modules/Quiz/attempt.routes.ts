import express from 'express';
import { AttemptController } from './attempt.controller.js';
import { requireAuth, requireRole } from '../../middlewares/betterAuth.js';
import { Role } from '../../types/role.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { submitQuizSchema } from '../../validations/attempt.validation.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(Role.LEARNER, Role.ADMIN, Role.SUPERADMIN));

router.get('/:quizId/info', AttemptController.getQuizInfo);
router.post('/:quizId/attempts/start', AttemptController.startAttempt);
router.post('/:quizId/attempts/:attemptId/submit', validateRequest(submitQuizSchema), AttemptController.submitAttempt);
router.get('/:quizId/attempts/:attemptId/result', AttemptController.getAttemptResult);
router.get('/:quizId/attempts', AttemptController.getUserAttempts);
router.get('/attempts/:attemptId', AttemptController.getAttemptById);

export const AttemptRoutes = router;
