import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { ContentService } from './content.service.js';

/**
 * Get all modules for a batch with progress
 */
const getBatchModules = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params as { batchId: string };
    const enrollment = (req as any).enrollment;

    const result = await ContentService.getBatchModules(batchId, enrollment._id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Modules retrieved successfully',
        data: result,
    });
});

/**
 * Get lessons for a module with progress
 */
const getModuleLessons = catchAsync(async (req: Request, res: Response) => {
    const { batchId, moduleId } = req.params as { batchId: string; moduleId: string };
    const enrollment = (req as any).enrollment;

    const result = await ContentService.getModuleLessons(enrollment._id, moduleId, batchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lessons retrieved successfully',
        data: result,
    });
});

/**
 * Get lesson details with video URL
 */
const getLessonDetails = catchAsync(async (req: Request, res: Response) => {
    const { batchId, moduleId, lessonId } = req.params as { batchId: string; moduleId: string; lessonId: string };
    const enrollment = (req as any).enrollment;

    const result = await ContentService.getLessonDetails(enrollment._id, moduleId, lessonId, batchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lesson retrieved successfully',
        data: result,
    });
});

/**
 * Get module resources
 */
const getModuleResources = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const enrollment = (req as any).enrollment;

    const { batchId: resourcesBatchId } = req.params as { batchId: string };
    const result = await ContentService.getModuleResources(enrollment._id, moduleId, resourcesBatchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Resources retrieved successfully',
        data: result,
    });
});

/**
 * Get quizzes for a module with attempt progress
 */
const getModuleQuizzes = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const enrollment = (req as any).enrollment;

    const { batchId: quizzesBatchId } = req.params as { batchId: string };
    const result = await ContentService.getModuleQuizzes(enrollment._id, moduleId, quizzesBatchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Quizzes retrieved successfully',
        data: result,
    });
});

/**
 * Get unified curriculum (lessons + quizzes) for a module
 */
const getModuleCurriculum = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const enrollment = (req as any).enrollment;

    const { batchId: curriculumBatchId } = req.params as { batchId: string };
    const result = await ContentService.getModuleCurriculum(enrollment._id, moduleId, curriculumBatchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Curriculum retrieved successfully',
        data: result,
    });
});

export const ContentController = {
    getBatchModules,
    getModuleLessons,
    getLessonDetails,
    getModuleResources,
    getModuleQuizzes,
    getModuleCurriculum,
};
