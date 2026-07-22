import express, { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { LeaderboardController } from './leaderboard.controller.js';
import { requireAuth } from '../../middlewares/betterAuth.js';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { GamificationService } from './gamification.service.js';

const router = express.Router();

router.use(requireAuth);

router.get('/leaderboard', LeaderboardController.getGlobalLeaderboard);
router.get('/leaderboard/course/:courseId', LeaderboardController.getCourseLeaderboard);
router.get('/leaderboard/batch/:batchId', LeaderboardController.getBatchLeaderboard);

router.get('/zames/stats', catchAsync(async (req: Request, res: Response) => {
    const user = req.user as any;
    const stats = await GamificationService.getStats(user.id);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Zames stats retrieved successfully',
        data: stats,
    });
}));

router.get('/zames/history', catchAsync(async (req: Request, res: Response) => {
    const user = req.user as any;
    const { page, limit } = req.query;
    const history = await GamificationService.getTransactionHistory(
        user.id,
        page ? Number(page) : 1,
        limit ? Number(limit) : 20
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Zames history retrieved successfully',
        meta: history.meta,
        data: history.data,
    });
}));

export const LeaderboardRoutes = router;
