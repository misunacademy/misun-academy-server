import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { CourseService } from './course.service.js';

const createCourse = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const courseData = { ...req.body, createdBy: id };
    const course = await CourseService.createCourse(courseData);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Course created successfully',
        data: course,
    });
});

const getAllCourses = catchAsync(async (req: Request, res: Response) => {
    const { page = 1, limit = 10, ...filters } = req.query;
    const result = await CourseService.getCourses(filters as any, { page: Number(page), perPage: Number(limit) });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Courses retrieved successfully',
        meta: {
            page: result.page,
            limit: result.perPage,
            total: result.total,
            totalPages: Math.ceil(result.total / result.perPage),
        },
        data: result.data,
    });
});

const getCourseById = catchAsync(async (req: Request, res: Response) => {
    const course = await CourseService.getCourseById(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course retrieved successfully',
        data: course,
    });
});

const getCourseBySlug = catchAsync(async (req: Request, res: Response) => {
    const course = await CourseService.getCourseBySlug(req.params.slug as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course retrieved successfully',
        data: course,
    });
});

const updateCourse = catchAsync(async (req: Request, res: Response) => {
    const course = await CourseService.updateCourse(req.params.id as string, req.body);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course updated successfully',
        data: course,
    });
});

const deleteCourse = catchAsync(async (req: Request, res: Response) => {
    await CourseService.deleteCourse(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course deleted successfully',
        data: null,
    });
});

export const CourseController = {
    createCourse,
    getAllCourses,
    getCourseById,
    getCourseBySlug,
    updateCourse,
    deleteCourse,
};
