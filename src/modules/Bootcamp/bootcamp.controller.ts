import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { BootcampService } from './bootcamp.service.js';
import { BootcampRegistrationStatus } from './bootcamp.interface.js';

const registerForBootcamp = catchAsync(async (req: Request, res: Response) => {
    const result = await BootcampService.registerBootcampRegistration(
        req.body,
        req.ip
    );

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Bootcamp registration successful. Our team will contact you soon.',
        data: result,
    });
});

const getBootcampRegistrations = catchAsync(
    async (req: Request, res: Response) => {
        const { status, search, page, limit } = req.query as {
            status?: BootcampRegistrationStatus;
            search?: string;
            page?: string;
            limit?: string;
        };

        const result = await BootcampService.getAllBootcampRegistrations({
            status,
            search,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Bootcamp registrations retrieved successfully',
            data: result.data,
            meta: result.meta,
        });
    }
);

const getBootcampStats = catchAsync(async (_req: Request, res: Response) => {
    const result = await BootcampService.getBootcampRegistrationStats();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp registration stats retrieved successfully',
        data: result,
    });
});

const updateBootcampRegistration = catchAsync(
    async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const { id: actorId, role } = req.user as { id: string; role?: string };

        const result = await BootcampService.updateBootcampRegistration(
            id,
            req.body,
            { id: actorId, role },
            req.ip
        );

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Bootcamp registration updated successfully',
            data: result,
        });
    }
);

const deleteBootcampRegistration = catchAsync(
    async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const { id: actorId, role } = req.user as { id: string; role?: string };

        const result = await BootcampService.deleteBootcampRegistration(
            id,
            { id: actorId, role },
            req.ip
        );

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Bootcamp registration deleted successfully',
            data: result,
        });
    }
);

export const BootcampController = {
    registerForBootcamp,
    getBootcampRegistrations,
    getBootcampStats,
    updateBootcampRegistration,
    deleteBootcampRegistration,
};
