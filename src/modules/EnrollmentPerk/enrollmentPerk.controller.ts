import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { EnrollmentPerkService } from './enrollmentPerk.service.js';

const createRule = catchAsync(async (req: Request, res: Response) => {
    const { id: creatorId } = req.user as { id: string; role?: string };
    const result = await EnrollmentPerkService.createRule(req.body, creatorId);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Perk rule created successfully',
        data: result,
    });
});

const listRules = catchAsync(async (req: Request, res: Response) => {
    const { courseId, batchId, isActive, search, page, limit } = req.query as {
        courseId?: string;
        batchId?: string;
        isActive?: string;
        search?: string;
        page?: string;
        limit?: string;
    };

    const result = await EnrollmentPerkService.listRules({
        courseId,
        batchId,
        isActive,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Perk rules retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

const getRuleById = catchAsync(async (req: Request, res: Response) => {
    const result = await EnrollmentPerkService.getRuleById(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Perk rule retrieved successfully',
        data: result,
    });
});

const updateRule = catchAsync(async (req: Request, res: Response) => {
    const result = await EnrollmentPerkService.updateRule(req.params.id as string, req.body);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Perk rule updated successfully',
        data: result,
    });
});

const toggleRuleStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await EnrollmentPerkService.toggleRuleStatus(
        req.params.id as string,
        req.body.isActive
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `Perk rule ${req.body.isActive ? 'activated' : 'deactivated'} successfully`,
        data: result,
    });
});

const deleteRule = catchAsync(async (req: Request, res: Response) => {
    const result = await EnrollmentPerkService.deleteRule(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: result.message,
        data: null,
    });
});

const previewBackfill = catchAsync(async (req: Request, res: Response) => {
    const result = await EnrollmentPerkService.previewBackfill(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Backfill preview generated successfully',
        data: result,
    });
});

const executeBackfill = catchAsync(async (req: Request, res: Response) => {
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await EnrollmentPerkService.executeBackfill(
        req.params.id as string,
        { id: actorId, role }
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `Backfill completed. Granted perks to ${result.totalGranted} student(s).`,
        data: result,
    });
});

const listGrantLogs = catchAsync(async (req: Request, res: Response) => {
    const { ruleId, studentId, status, search, page, limit } = req.query as {
        ruleId?: string;
        studentId?: string;
        status?: string;
        search?: string;
        page?: string;
        limit?: string;
    };

    const result = await EnrollmentPerkService.listGrantLogs({
        ruleId,
        studentId,
        status,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Perk grant logs retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

export const EnrollmentPerkController = {
    createRule,
    listRules,
    getRuleById,
    updateRule,
    toggleRuleStatus,
    deleteRule,
    previewBackfill,
    executeBackfill,
    listGrantLogs,
};
