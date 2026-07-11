import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync.js";
import sendResponse from "../../utils/sendResponse.js";
import { BatchService } from "./batch.service.js";
import { StatusCodes } from "http-status-codes";

const createBatch = catchAsync(async (req: Request, res: Response) => {
    const result = await BatchService.createBatch(req.body);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Batch Created successfully !',
        data: result,
    });
});

const getAllBatches = catchAsync(async (req: Request, res: Response) => {
    const { status, courseId, upcoming, page = 1, limit = 10 } = req.query;
    const result = await BatchService.getAllBatches({
        status: status as any,
        courseId: courseId as string,
        upcoming: upcoming === 'true',
        page: Number(page),
        limit: Number(limit),
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batches retrieved successfully',
        data: result.data,
        meta: result.pagination
    });
});

const getUpcomingBatches = catchAsync(async (req: Request, res: Response) => {
    const { courseId } = req.query;
    const result = await BatchService.getUpcomingBatches({
        courseId: courseId as string,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Upcoming batches retrieved successfully',
        data: result,
    });
});

const getCurrentEnrollmentBatch = catchAsync(async (req: Request, res: Response) => {
    const { courseId } = req.query;
    const result = await BatchService.getCurrentEnrollmentBatch(courseId as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Current enrollment batch retrieved successfully',
        data: result,
    });
});

const getCurrentEnrollmentBatches = catchAsync(async (req: Request, res: Response) => {
    const result = await BatchService.getCurrentEnrollmentBatchesForCourses();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Current enrollment batches retrieved successfully',
        data: result,
    });
});

const getBatchById = catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const result = await BatchService.getBatchById(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch Retrive successfully !',
        data: result,
    });
});

const updateBatch = catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const data = req.body;

    const result = await BatchService.updateBatch(id, data);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch updated successfully',
        data: result,
    });
});

const transitionBatchStatus = catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { status } = req.body;
    const result = await BatchService.transitionBatchStatus(id, status);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `Batch transitioned to ${status} successfully`,
        data: result,
    });
});

const runAutoTransition = catchAsync(async (req: Request, res: Response) => {
    const result = await BatchService.runAutoTransition();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Auto-transition completed',
        data: result,
    });
});

const deleteBatch = catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const result = await BatchService.deleteBatch(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch deleted successfully',
        data: result,
    });
});

export const BatchController = {
    createBatch,
    getAllBatches,
    getUpcomingBatches,
    getCurrentEnrollmentBatch,
    getCurrentEnrollmentBatches,
    getBatchById,
    updateBatch,
    transitionBatchStatus,
    runAutoTransition,
    deleteBatch,
};
