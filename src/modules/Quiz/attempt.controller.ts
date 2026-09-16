import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { AttemptService } from './attempt.service.js';
import { QuizService } from './quiz.service.js';

const startAttempt = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };
    const user = req.user as any;
    const enrollmentId = req.query.enrollmentId as string;

    if (!enrollmentId) {
        return sendResponse(res, {
            statusCode: StatusCodes.BAD_REQUEST,
            success: false,
            message: 'enrollmentId query parameter is required',
            data: null,
        });
    }

    const result = await AttemptService.startAttempt(quizId, user.id, enrollmentId);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Quiz attempt started successfully',
        data: result,
    });
});

const submitAttempt = catchAsync(async (req: Request, res: Response) => {
    const { attemptId } = req.params as { attemptId: string };
    const user = req.user as any;
    const { answers, timeTaken } = req.body;

    const attempt = await AttemptService.submitAttempt(attemptId, user.id, answers, timeTaken);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quiz submitted successfully',
        data: attempt,
    });
});

const getAttemptResult = catchAsync(async (req: Request, res: Response) => {
    const { attemptId } = req.params as { attemptId: string };
    const user = req.user as any;

    const result = await AttemptService.getAttemptResult(attemptId, user.id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Attempt result retrieved successfully',
        data: result,
    });
});

const getUserAttempts = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };
    const user = req.user as any;

    const attempts = await AttemptService.getUserAttempts(quizId, user.id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Attempts retrieved successfully',
        data: attempts,
    });
});

const getAttemptById = catchAsync(async (req: Request, res: Response) => {
    const { attemptId } = req.params as { attemptId: string };
    const user = req.user as any;

    const attempt = await AttemptService.getAttemptById(attemptId, user.id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Attempt retrieved successfully',
        data: attempt,
    });
});

const getQuizInfo = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };

    const quiz = await QuizService.getQuizById(quizId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quiz info retrieved successfully',
        data: quiz,
    });
});

export const AttemptController = {
    startAttempt,
    submitAttempt,
    getAttemptResult,
    getUserAttempts,
    getAttemptById,
    getQuizInfo,
};
