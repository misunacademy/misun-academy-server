import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { LeaderboardService } from './leaderboard.service.js';

const getGlobalLeaderboard = catchAsync(async (req: Request, res: Response) => {
    const { period, month, year, page, limit } = req.query;

    const result = await LeaderboardService.getLeaderboard({
        type: 'global',
        period: (period as any) || 'all_time',
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Leaderboard retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

const getCourseLeaderboard = catchAsync(async (req: Request, res: Response) => {
    const { courseId } = req.params;
    const { period, month, year, page, limit } = req.query;

    const result = await LeaderboardService.getLeaderboard({
        type: 'course',
        referenceId: courseId,
        period: (period as any) || 'all_time',
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course leaderboard retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

const getBatchLeaderboard = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params;
    const { period, month, year, page, limit } = req.query;

    const result = await LeaderboardService.getLeaderboard({
        type: 'batch',
        referenceId: batchId,
        period: (period as any) || 'all_time',
        month: month ? Number(month) : undefined,
        year: year ? Number(year) : undefined,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch leaderboard retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

export const LeaderboardController = {
    getGlobalLeaderboard,
    getCourseLeaderboard,
    getBatchLeaderboard,
};
