import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { QuizService } from './quiz.service.js';
import { QuizAttemptModel } from './attempt.model.js';
import { AttemptStatus } from '../../types/common.js';

const createQuiz = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const { id: userId } = req.user as any;
    const quizData = req.body;

    const quiz = await QuizService.createQuiz(moduleId, quizData, userId);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Quiz created successfully',
        data: quiz,
    });
});

const getModuleQuizzes = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };

    const quizzes = await QuizService.getModuleQuizzes(moduleId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quizzes retrieved successfully',
        data: quizzes,
    });
});

const getQuizById = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };

    const quiz = await QuizService.getQuizById(quizId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quiz retrieved successfully',
        data: quiz,
    });
});

const updateQuiz = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };
    const updateData = req.body;

    const quiz = await QuizService.updateQuiz(quizId, updateData);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quiz updated successfully',
        data: quiz,
    });
});

const deleteQuiz = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };

    await QuizService.deleteQuiz(quizId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quiz deleted successfully',
        data: null,
    });
});

const reorderQuizzes = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const { quizOrders } = req.body;

    const quizzes = await QuizService.reorderQuizzes(moduleId, quizOrders);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quizzes reordered successfully',
        data: quizzes,
    });
});

const getAllQuizzes = catchAsync(async (req: Request, res: Response) => {
    const { search, status, courseId, page, limit } = req.query;

    const result = await QuizService.getAllQuizzes({
        search: search as string,
        status: status as string,
        courseId: courseId as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quizzes retrieved successfully',
        meta: result.meta,
        data: { quizzes: result.data, stats: result.stats },
    });
});

const getQuizAnalytics = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };

    const analytics = await QuizService.getQuizAnalytics(quizId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quiz analytics retrieved successfully',
        data: analytics,
    });
});

export const QuizController = {
    createQuiz,
    getModuleQuizzes,
    getQuizById,
    updateQuiz,
    deleteQuiz,
    reorderQuizzes,
    getAllQuizzes,
    getQuizAnalytics,
};
