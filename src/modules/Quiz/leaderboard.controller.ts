import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { LeaderboardService } from './leaderboard.service.js';
import { GamificationService } from './gamification.service.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { EnrollmentStatus } from '../../types/common.js';
import ApiError from '../../errors/ApiError.js';

const STAFF_ROLES = ['admin', 'superadmin', 'instructor', 'employee'];

// Batch/course leaderboards expose class rosters — restrict to members
// (active/completed enrollment) and staff. Global board stays public to auth.
const assertBoardAccess = async (user: any, type: 'course' | 'batch', referenceId: string) => {
    if (!referenceId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Reference ID is required');
    }
    if (user?.role && STAFF_ROLES.includes(user.role)) return;

    if (type === 'batch') {
        const mine = await EnrollmentModel.exists({
            userId: user.id,
            batchId: referenceId,
            status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
        });
        if (!mine) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Leaderboard not available for this batch');
        }
        return;
    }

    const batchIds = await BatchModel.find({ courseId: referenceId }).select('_id').lean();
    const mine = batchIds.length
        ? await EnrollmentModel.exists({
            userId: user.id,
            batchId: { $in: batchIds.map((b) => b._id) },
            status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
        })
        : null;
    if (!mine) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'Leaderboard not available for this course');
    }
};

const parsePeriod = (value: unknown): 'all_time' | 'monthly' =>
    value === 'monthly' ? 'monthly' : 'all_time';

const getGlobalLeaderboard = catchAsync(async (req: Request, res: Response) => {
    const { period, month, year, page, limit } = req.query;

    const result = await LeaderboardService.getLeaderboard({
        type: 'global',
        period: parsePeriod(period),
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
    const refId = Array.isArray(courseId) ? courseId[0] : courseId;

    await assertBoardAccess(req.user, 'course', refId as string);

    const result = await LeaderboardService.getLeaderboard({
        type: 'course',
        referenceId: refId,
        period: parsePeriod(period),
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
    const refId = Array.isArray(batchId) ? batchId[0] : batchId;

    await assertBoardAccess(req.user, 'batch', refId as string);

    const result = await LeaderboardService.getLeaderboard({
        type: 'batch',
        referenceId: refId,
        period: parsePeriod(period),
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

const getZamesStats = catchAsync(async (req: Request, res: Response) => {
    const user = req.user as any;
    const { courseId, batchId } = req.query;
    const stats = await GamificationService.getStats(
        user.id,
        courseId as string | undefined,
        batchId as string | undefined
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Zames stats retrieved successfully',
        data: stats,
    });
});

const getZamesHistory = catchAsync(async (req: Request, res: Response) => {
    const user = req.user as any;
    const { courseId, batchId, page, limit } = req.query;
    const history = await GamificationService.getTransactionHistory(
        user.id,
        courseId as string | undefined,
        batchId as string | undefined,
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
});

export const LeaderboardController = {
    getGlobalLeaderboard,
    getCourseLeaderboard,
    getBatchLeaderboard,
    getZamesStats,
    getZamesHistory,
};
