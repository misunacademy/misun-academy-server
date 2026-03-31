import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { InstructorService } from './instructor.service.js';

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
 * Get instructor dashboard stats
 */
const getDashboard = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;

    const result = await InstructorService.getDashboard(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Dashboard data retrieved successfully',
        data: result,
    });
});

/**
 * Get assigned batches
 */
const getAssignedBatches = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { status } = req.query as { status?: string };

    const result = await InstructorService.getAssignedBatches(id, status);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Assigned batches retrieved successfully',
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

export const InstructorController = {
    getProfile,
    updateProfile,
    getDashboard,
    getAssignedBatches,
    getBatchStudents,
    getBatchStatistics,
};
