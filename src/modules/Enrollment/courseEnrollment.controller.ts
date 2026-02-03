import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { CourseEnrollmentService } from './courseEnrollment.service';

/**
 * Get course progress for the authenticated user
 */
const getCourseProgress = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params as { courseId: string };

    const progress = await CourseEnrollmentService.getCourseProgress(id, courseId);

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

export const CourseEnrollmentController = {
    getCourseProgress,
    completeLesson,
};