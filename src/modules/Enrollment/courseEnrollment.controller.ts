import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { CourseEnrollmentService } from './courseEnrollment.service.js';

/**
 * Get course progress for the authenticated user
 */
const getCourseProgress = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params as { courseId: string };
    const { batchId } = req.query as { batchId?: string };

    const progress = await CourseEnrollmentService.getCourseProgress(id, courseId, batchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course progress retrieved successfully',
        data: progress,
    });
});

/**
 * Complete a lesson for the authenticated user
 */
const completeLesson = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params;
    const { moduleId, lessonId } = req.body;

    const result = await CourseEnrollmentService.completeLesson(id, courseId as string, moduleId, lessonId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lesson completed successfully',
        data: result,
    });
});

/**
 * Record a server-validated watch-time heartbeat for a lesson.
 */
const recordWatchTime = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params;
    const { moduleId, lessonId, watchTime, lastWatchedPosition } = req.body;

    const result = await CourseEnrollmentService.recordWatchTime(
        id,
        courseId as string,
        moduleId as string,
        lessonId as string,
        Number(watchTime),
        Number(lastWatchedPosition)
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Watch time recorded successfully',
        data: result,
    });
});

export const CourseEnrollmentController = {
    getCourseProgress,
    completeLesson,
    recordWatchTime,
};