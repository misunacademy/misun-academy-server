import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { RecordingService } from './recording.service.js';
import { Role } from '../../types/role.js';

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

const getAllRecordings = catchAsync(async (req: Request, res: Response) => {
    const { courseId, batchId, isPublished, page, limit } = req.query;
    const user = (req as any).user;
    const parsedPage = page ? parseInt(page as string) : 1;
    const parsedLimit = limit ? parseInt(limit as string) : 20;

    const result = await RecordingService.getAllRecordings({
        courseId: courseId as string,
        batchId: batchId as string,
        isPublished: isPublished === 'true' ? true : isPublished === 'false' ? false : undefined,
        page: parsedPage,
        limit: parsedLimit,
        userId: user.role === Role.INSTRUCTOR ? user.id : undefined,
        userRole: user.role,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recordings retrieved successfully',
        data: result.data,
        meta: result.meta,
    });
});

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

const updateRecording = catchAsync(async (req: Request, res: Response) => {
    const { recordingId } = req.params as { recordingId: string };
    const userId = (req as any).user.id;
    const recording = await RecordingService.updateRecording(recordingId, req.body, userId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recording updated successfully',
        data: recording,
    });
});

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
