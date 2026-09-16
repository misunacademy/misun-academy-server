import express from 'express';
import { LeaderboardController } from './leaderboard.controller.js';
import { requireAuth } from '../../middlewares/betterAuth.js';

const router = express.Router();

router.use(requireAuth);

router.get('/leaderboard', LeaderboardController.getGlobalLeaderboard);
router.get('/leaderboard/course/:courseId', LeaderboardController.getCourseLeaderboard);
router.get('/leaderboard/batch/:batchId', LeaderboardController.getBatchLeaderboard);
router.get('/zames/stats', LeaderboardController.getZamesStats);
router.get('/zames/history', LeaderboardController.getZamesHistory);

export const LeaderboardRoutes = router;
