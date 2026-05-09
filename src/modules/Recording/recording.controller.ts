import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { RecordingService } from './recording.service.js';
import { CourseModel } from '../Course/course.model.js';
import { Role } from '../../types/role.js';

// Admin/Instructor: Create recording
const createRecording = catchAsync(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const recording = await RecordingService.createRecording(req.body, userId);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Recording created successfully',
        data: recording,
    });
});

// Admin/Instructor: Get all recordings with filters
// Instructors automatically see only recordings for their assigned courses.
const getAllRecordings = catchAsync(async (req: Request, res: Response) => {
    const { courseId, batchId, isPublished, page, limit } = req.query;
    const user = (req as any).user;

    // For instructors, restrict to their assigned courses
    let allowedCourseId = courseId as string | undefined;
    if (user.role === Role.INSTRUCTOR) {
        const assignedCourses = await CourseModel.find(
            { instructorId: user.id },
            '_id'
        ).lean();
        const assignedIds = assignedCourses.map((c: any) => c._id.toString());

        if (courseId && !assignedIds.includes(courseId as string)) {
            // Requested course not assigned to this instructor
            return sendResponse(res, {
                statusCode: StatusCodes.OK,
                success: true,
                message: 'Recordings retrieved successfully',
                data: [],
                meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
            });
        }
        if (!courseId) {
            // No specific course requested — must pass courseIds array
            // Use the service's courseIds filter (extend call below)
            allowedCourseId = undefined; // handled via courseIds
            return sendResponse(res, await (async () => {
                const result = await RecordingService.getAllRecordings({
                    courseIds: assignedIds,
                    batchId: batchId as string,
                    isPublished: isPublished === 'true' ? true : isPublished === 'false' ? false : undefined,
                    page: page ? parseInt(page as string) : undefined,
                    limit: limit ? parseInt(limit as string) : undefined,
                });
                return {
                    statusCode: StatusCodes.OK,
                    success: true,
                    message: 'Recordings retrieved successfully',
                    data: result.data,
                    meta: result.meta,
                };
            })());
        }
    }

    const result = await RecordingService.getAllRecordings({
        courseId: allowedCourseId,
        batchId: batchId as string,
        isPublished: isPublished === 'true' ? true : isPublished === 'false' ? false : undefined,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recordings retrieved successfully',
        data: result.data,
        meta: result.meta,
    });
});


// Admin: Get recording by ID
const getRecordingById = catchAsync(async (req: Request, res: Response) => {
    const { recordingId } = req.params as { recordingId: string };
    const recording = await RecordingService.getRecordingById(recordingId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recording retrieved successfully',
        data: recording,
    });
});

// Student: Get recordings for enrolled batch
const getBatchRecordings = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params as { batchId: string };
    const recordings = await RecordingService.getBatchRecordings(batchId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch recordings retrieved successfully',
        data: recordings,
    });
});

// Student: Get all recordings for all enrolled batches
const getStudentRecordings = catchAsync(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const recordings = await RecordingService.getStudentRecordings(userId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Student recordings retrieved successfully',
        data: recordings,
    });
});

// Admin: Update recording
const updateRecording = catchAsync(async (req: Request, res: Response) => {
    const { recordingId } = req.params as { recordingId: string };
    const recording = await RecordingService.updateRecording(recordingId, req.body);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recording updated successfully',
        data: recording,
    });
});

// Admin: Delete recording
const deleteRecording = catchAsync(async (req: Request, res: Response) => {
    const { recordingId } = req.params as { recordingId: string };
    await RecordingService.deleteRecording(recordingId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recording deleted successfully',
        data: null,
    });
});

// Student: Increment view count
const incrementViewCount = catchAsync(async (req: Request, res: Response) => {
    const { recordingId } = req.params as { recordingId: string };
    await RecordingService.incrementViewCount(recordingId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'View count updated',
        data: null,
    });
});

export const RecordingController = {
    createRecording,
    getAllRecordings,
    getRecordingById,
    getBatchRecordings,
    getStudentRecordings,
    updateRecording,
    deleteRecording,
    incrementViewCount,
};
