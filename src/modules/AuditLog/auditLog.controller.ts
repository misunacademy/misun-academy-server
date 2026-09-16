import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { AuditLogService } from './auditLog.service.js';

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
    const result = await AuditLogService.getAuditLogs(req.query as Record<string, string>);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Audit logs retrieved successfully',
        data: result,
    });
});

export const AuditLogController = {
    getAuditLogs,
};
