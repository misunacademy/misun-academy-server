import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { BootcampCatalogService } from './bootcampCatalog.service.js';

const getCurrentBootcamp = catchAsync(async (_req: Request, res: Response) => {
    const result = await BootcampCatalogService.getCurrentBootcamp();
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: result ? 'Current bootcamp retrieved' : 'No upcoming bootcamp',
        data: result,
    });
});

const getPastBootcamps = catchAsync(async (_req: Request, res: Response) => {
    const result = await BootcampCatalogService.getPastBootcamps();
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Past bootcamps retrieved',
        data: result,
    });
});

const getBootcampBySlug = catchAsync(async (req: Request, res: Response) => {
    const { slug } = req.params as { slug: string };
    const result = await BootcampCatalogService.getBootcampBySlug(slug);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp retrieved',
        data: result,
    });
});

const listBootcampsAdmin = catchAsync(async (req: Request, res: Response) => {
    const { status, search, page, limit } = req.query as {
        status?: string;
        search?: string;
        page?: string;
        limit?: string;
    };
    const result = await BootcampCatalogService.listBootcampsAdmin({
        status,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamps retrieved',
        data: result.data,
        meta: result.meta,
    });
});

const createBootcamp = catchAsync(async (req: Request, res: Response) => {
    const { id, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.createBootcamp(req.body, { id, role });
    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Bootcamp created',
        data: result,
    });
});

const updateBootcamp = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.updateBootcamp(id, req.body, {
        id: actorId,
        role,
    });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp updated',
        data: result,
    });
});

const setRecordedPrice = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.setRecordedPrice(
        id,
        req.body.recordedPrice,
        { id: actorId, role }
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recorded price updated',
        data: result,
    });
});

const publishRecording = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.publishRecording(
        id,
        { id: actorId, role },
        req.body ?? {}
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recording published',
        data: result,
    });
});

export const BootcampCatalogController = {
    getCurrentBootcamp,
    getPastBootcamps,
    getBootcampBySlug,
    listBootcampsAdmin,
    createBootcamp,
    updateBootcamp,
    setRecordedPrice,
    publishRecording,
};
