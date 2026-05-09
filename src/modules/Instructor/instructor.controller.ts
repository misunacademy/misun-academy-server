import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { InstructorService } from './instructor.service.js';
import ApiError from '../../errors/ApiError.js';

/**
 * Get instructor profile
 */
const getProfile = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;

    const result = await InstructorService.getProfile(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Instructor profile retrieved successfully',
        data: result,
    });
});

/**
 * Update instructor profile
 */
const updateProfile = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const updateData = req.body;

    const result = await InstructorService.updateProfile(id, updateData);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Profile updated successfully',
        data: result,
    });
});



/**
 * Get courses with embedded batches)
 */
const getCoursesWithBatches = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;

    const result = await InstructorService.getCoursesWithBatches(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Assigned courses retrieved successfully',
        data: result,
    });
});

/**
 * Get batch students roster
 */
const getBatchStudents = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params as { batchId: string };
    const { id } = req.user as any;

    const result = await InstructorService.getBatchStudents(id, batchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch students retrieved successfully',
        data: result,
    });
});

/**
 * Get batch statistics
 */
const getBatchStatistics = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params as { batchId: string };
    const { id } = req.user as any;

    const result = await InstructorService.getBatchStatistics(id, batchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch statistics retrieved successfully',
        data: result,
    });
});

/** Get courses assigned to the instructor */
const getAssignedCourses = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const result = await InstructorService.getCoursesWithBatches(id);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Assigned courses retrieved successfully', data: result });
});

/** Get modules for an assigned course */
const getCourseModules = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params as { courseId: string };
    const { batchId } = req.query as { batchId?: string };
    if (!batchId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch ID is required');
    }
    const result = await InstructorService.getCourseModulesForInstructor(id, courseId, batchId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Modules retrieved successfully', data: result });
});

/** Create a module for an assigned course */
const createCourseModule = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params as { courseId: string };
    const { batchId } = req.query as { batchId?: string };
    if (!batchId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch ID is required');
    }
    const result = await InstructorService.createModuleForInstructor(id, courseId, batchId, req.body);
    sendResponse(res, { statusCode: StatusCodes.CREATED, success: true, message: 'Module created successfully', data: result });
});

/** Reorder modules for an assigned course */
const reorderCourseModules = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { courseId } = req.params as { courseId: string };
    const { batchId } = req.query as { batchId?: string };
    const { moduleOrders } = req.body as { moduleOrders: { moduleId: string; orderIndex: number }[] };

    if (!batchId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch ID is required');
    }

    const result = await InstructorService.reorderCourseModulesForInstructor(
        id,
        courseId,
        batchId,
        moduleOrders
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Modules reordered successfully',
        data: result,
    });
});

/** Update a module */
const updateCourseModule = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { moduleId } = req.params as { moduleId: string };
    const result = await InstructorService.updateModuleForInstructor(id, moduleId, req.body);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Module updated successfully', data: result });
});

/** Delete a module */
const deleteCourseModule = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { moduleId } = req.params as { moduleId: string };
    await InstructorService.deleteModuleForInstructor(id, moduleId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Module deleted successfully', data: null });
});

/** Get lessons for a module */
const getModuleLessons = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { moduleId } = req.params as { moduleId: string };
    const result = await InstructorService.getModuleLessonsForInstructor(id, moduleId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Lessons retrieved successfully', data: result });
});

/** Create a lesson for a module */
const createModuleLesson = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { moduleId } = req.params as { moduleId: string };
    const result = await InstructorService.createLessonForInstructor(id, moduleId, req.body);
    sendResponse(res, { statusCode: StatusCodes.CREATED, success: true, message: 'Lesson created successfully', data: result });
});

/** Update a lesson */
const updateModuleLesson = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { lessonId } = req.params as { lessonId: string };
    const result = await InstructorService.updateLessonForInstructor(id, lessonId, req.body);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Lesson updated successfully', data: result });
});

/** Delete a lesson */
const deleteModuleLesson = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { lessonId } = req.params as { lessonId: string };
    await InstructorService.deleteLessonForInstructor(id, lessonId);
    sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: 'Lesson deleted successfully', data: null });
});

export const InstructorController = {
    getProfile,
    updateProfile,
    getCoursesWithBatches,
    getBatchStudents,
    getBatchStatistics,
    getAssignedCourses,
    getCourseModules,
    createCourseModule,
    reorderCourseModules,
    updateCourseModule,
    deleteCourseModule,
    getModuleLessons,
    createModuleLesson,
    updateModuleLesson,
    deleteModuleLesson,
};
