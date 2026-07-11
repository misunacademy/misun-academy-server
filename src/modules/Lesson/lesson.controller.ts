import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { LessonService } from './lesson.service.js';
import { ModuleModel } from '../Module/module.model.js';
import { NotificationService } from '../Notification/notification.service.js';

/**
 * Create a new lesson for a module
 */
const createLesson = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const lessonData = req.body;

    const lesson = await LessonService.createLesson(moduleId, lessonData);

    if (lesson.isPublished) {
        setImmediate(async () => {
            try {
                const module = await ModuleModel.findById(moduleId);
                if (module?.batchId) {
                    await NotificationService.createBatchNotification(
                        module.batchId.toString(),
                        {
                            type: 'lesson_published',
                            title: 'New Lesson Available',
                            message: `New lesson "${lesson.title}" has been published`,
                            link: '/my-classes',
                        }
                    );
                }
            } catch (error) {
                console.error('Failed to send lesson notification:', error);
            }
        });
    }

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Lesson created successfully',
        data: lesson,
    });
});

/**
 * Get all lessons for a module
 */
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

/**
 * Get lesson by ID
 */
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

/**
 * Update lesson
 */
const updateLesson = catchAsync(async (req: Request, res: Response) => {
    const { lessonId } = req.params as { lessonId: string };
    const updateData = req.body;

    const { LessonModel } = await import('./lesson.model.js');
    const oldLesson = await LessonModel.findById(lessonId).lean();

    const lesson = await LessonService.updateLesson(lessonId, updateData);

    const wasPublished = oldLesson?.isPublished;
    if (!wasPublished && lesson.isPublished) {
        setImmediate(async () => {
            try {
                const module = await ModuleModel.findById(lesson.moduleId);
                if (module?.batchId) {
                    await NotificationService.createBatchNotification(
                        module.batchId.toString(),
                        {
                            type: 'lesson_published',
                            title: 'New Lesson Available',
                            message: `New lesson "${lesson.title}" has been published`,
                            link: '/my-classes',
                        }
                    );
                }
            } catch (error) {
                console.error('Failed to send lesson notification:', error);
            }
        });
    }

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Lesson updated successfully',
        data: lesson,
    });
});

/**
 * Delete lesson
 */
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

/**
 * Reorder lessons in a module
 */
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

export const LessonController = {
    createLesson,
    getModuleLessons,
    getLessonById,
    updateLesson,
    deleteLesson,
    reorderLessons,
};
