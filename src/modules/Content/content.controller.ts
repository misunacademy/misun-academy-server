import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { ContentService } from './content.service';

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
    const { moduleId } = req.params as { moduleId: string };
    const enrollment = (req as any).enrollment;

    const result = await ContentService.getModuleLessons(enrollment._id, moduleId);

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
    const { moduleId, lessonId } = req.params as { moduleId: string; lessonId: string };
    const enrollment = (req as any).enrollment;

    const result = await ContentService.getLessonDetails(enrollment._id, moduleId, lessonId);

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

    const result = await ContentService.getModuleResources(enrollment._id, moduleId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Resources retrieved successfully',
        data: result,
    });
});

/**
 * Update lesson progress
 */
const updateLessonProgress = catchAsync(async (req: Request, res: Response) => {
    const { lessonId } = req.params as { lessonId: string };
    const enrollment = (req as any).enrollment;
    const { watchTime, lastWatchedPosition } = req.body;

    const result = await ContentService.updateLessonProgress(
        enrollment._id,
        lessonId,
        watchTime,
        lastWatchedPosition
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Progress updated successfully',
        data: result,
    });
});

/**
 * Get batch overall progress
 */
const getBatchProgress = catchAsync(async (req: Request, res: Response) => {
    const enrollment = (req as any).enrollment;

    const result = await ContentService.getBatchProgress(enrollment._id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Progress retrieved successfully',
        data: result,
    });
});

export const ContentController = {
    getBatchModules,
    getModuleLessons,
    getLessonDetails,
    getModuleResources,
    updateLessonProgress,
    getBatchProgress,
};
