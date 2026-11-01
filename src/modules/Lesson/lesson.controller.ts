import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { LessonService } from './lesson.service.js';

const createLesson = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const lessonData = req.body;

    const lesson = await LessonService.createLesson(moduleId, lessonData);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Lesson created successfully',
        data: lesson,
    });
});

const getModuleLessons = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const { type } = req.query as { type?: string };

    const lessons = await LessonService.getModuleLessons(moduleId, type);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lessons retrieved successfully',
        data: lessons,
    });
});

const getLessonById = catchAsync(async (req: Request, res: Response) => {
    const { lessonId } = req.params as { lessonId: string };

    const lesson = await LessonService.getLessonById(lessonId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lesson retrieved successfully',
        data: lesson,
    });
});

const updateLesson = catchAsync(async (req: Request, res: Response) => {
    const { lessonId } = req.params as { lessonId: string };
    const updateData = req.body;

    const lesson = await LessonService.updateLesson(lessonId, updateData);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lesson updated successfully',
        data: lesson,
    });
});

const deleteLesson = catchAsync(async (req: Request, res: Response) => {
    const { lessonId } = req.params as { lessonId: string };

    await LessonService.deleteLesson(lessonId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lesson deleted successfully',
        data: null,
    });
});

const reorderLessons = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const { lessonOrders } = req.body;

    const lessons = await LessonService.reorderLessons(moduleId, lessonOrders);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lessons reordered successfully',
        data: lessons,
    });
});

/**
 * Generate a signed, expiring URL for lesson video delivery.
 * Requires active enrollment in the lesson's batch.
 */
const generateSignedVideoUrl = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { lessonId } = req.params as { lessonId: string };

    const result = await LessonService.generateSignedVideoUrl(lessonId, id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Signed video URL generated',
        data: result,
    });
});

export const LessonController = {
    createLesson,
    getModuleLessons,
    getLessonById,
    updateLesson,
    deleteLesson,
    reorderLessons,
    generateSignedVideoUrl,
};
