import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { QuestionService } from './question.service.js';

const createQuestion = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };
    const questionData = req.body;

    const question = await QuestionService.createQuestion(quizId, questionData);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Question created successfully',
        data: question,
    });
});

const getQuizQuestions = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };

    const questions = await QuestionService.getQuizQuestions(quizId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Questions retrieved successfully',
        data: questions,
    });
});

const getQuestionById = catchAsync(async (req: Request, res: Response) => {
    const { questionId } = req.params as { questionId: string };

    const question = await QuestionService.getQuestionById(questionId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Question retrieved successfully',
        data: question,
    });
});

const updateQuestion = catchAsync(async (req: Request, res: Response) => {
    const { questionId } = req.params as { questionId: string };
    const updateData = req.body;

    const question = await QuestionService.updateQuestion(questionId, updateData);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Question updated successfully',
        data: question,
    });
});

const deleteQuestion = catchAsync(async (req: Request, res: Response) => {
    const { questionId } = req.params as { questionId: string };

    await QuestionService.deleteQuestion(questionId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Question deleted successfully',
        data: null,
    });
});

const duplicateQuestion = catchAsync(async (req: Request, res: Response) => {
    const { questionId } = req.params as { questionId: string };

    const question = await QuestionService.duplicateQuestion(questionId);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Question duplicated successfully',
        data: question,
    });
});

const reorderQuestions = catchAsync(async (req: Request, res: Response) => {
    const { quizId } = req.params as { quizId: string };
    const { questionOrders } = req.body;

    const questions = await QuestionService.reorderQuestions(quizId, questionOrders);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Questions reordered successfully',
        data: questions,
    });
});

export const QuestionController = {
    createQuestion,
    getQuizQuestions,
    getQuestionById,
    updateQuestion,
    deleteQuestion,
    duplicateQuestion,
    reorderQuestions,
};
