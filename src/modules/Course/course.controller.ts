import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { CourseService } from './course.service.js';
import { recordAudit } from '../../models/auditLog.model.js';

const createCourse = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const courseData = { ...req.body, createdBy: id };
    const course = await CourseService.createCourse(courseData);

    await recordAudit({
        actor: id,
        action: 'course.create',
        targetType: 'Course',
        targetId: course._id?.toString(),
        metadata: { title: course.title },
    });

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
        meta: result.meta,
        data: result.data,
    });
});

const getCourseById = catchAsync(async (req: Request, res: Response) => {
    const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
    const course = await CourseService.getCourseById(req.params.id as string, { batchId });

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
    const { id: actorId } = req.user as any;
    const before = await CourseService.getCourseById(req.params.id as string);
    const course = await CourseService.updateCourse(req.params.id as string, req.body);

    if (before && course && (before as any).status !== (course as any).status) {
        await recordAudit({
            actor: actorId,
            action: `course.${(course as any).status === 'published' ? 'publish' : 'status_change'}`,
            targetType: 'Course',
            targetId: String(course._id),
            metadata: { from: (before as any).status, to: (course as any).status },
        });
    }

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course updated successfully',
        data: course,
    });
});

const deleteCourse = catchAsync(async (req: Request, res: Response) => {
    const { id: actorId } = req.user as any;
    const courseId = req.params.id as string;
    await CourseService.deleteCourse(courseId);

    await recordAudit({
        actor: actorId,
        action: 'course.delete',
        targetType: 'Course',
        targetId: courseId,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Course deleted successfully',
        data: null,
    });
});

const assignInstructor = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { instructorId } = req.body as { instructorId: string | null };
    const { id: actorId } = req.user as any;

    const course = await CourseService.assignInstructor(id, instructorId ?? null);

    await recordAudit({
        actor: actorId,
        action: 'course.instructor_assign',
        targetType: 'Course',
        targetId: String(course._id),
        metadata: { instructorId: instructorId ?? null },
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: instructorId ? 'Instructor assigned successfully' : 'Instructor removed successfully',
        data: course,
    });
});

export const CourseController = {
    createCourse,
    getAllCourses,
    getCourseById,
    getCourseBySlug,
    updateCourse,
    deleteCourse,
    assignInstructor,
};
