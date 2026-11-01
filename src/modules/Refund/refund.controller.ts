import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { RefundService } from './refund.service.js';
import { RefundStatus } from './refund.interface.js';

const createRefund = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId, role } = req.user as { id: string; role?: string };
  const result = await RefundService.createRefund(req.body, { id: actorId, role }, req.ip);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Refund request created successfully',
    data: result,
  });
});

const listRefunds = catchAsync(async (req: Request, res: Response) => {
  const { status, search, page, limit } = req.query as {
    status?: RefundStatus;
    search?: string;
    page?: string;
    limit?: string;
  };

  const result = await RefundService.listRefunds({
    status,
    search,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Refunds retrieved successfully',
    meta: result.meta,
    data: result.data,
  });
});

const getRefundById = catchAsync(async (req: Request, res: Response) => {
  const refund = await RefundService.getRefundById(req.params.id as string);
  if (!refund) {
    return sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: 'Refund not found',
      data: null,
    });
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Refund retrieved successfully',
    data: refund,
  });
});

const approveRefund = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId, role } = req.user as { id: string; role?: string };
  const refund = await RefundService.approveRefund(req.params.id as string, req.body?.note, { id: actorId, role }, req.ip);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Refund approved successfully',
    data: refund,
  });
});

const rejectRefund = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId, role } = req.user as { id: string; role?: string };
  const refund = await RefundService.rejectRefund(req.params.id as string, req.body?.note, { id: actorId, role }, req.ip);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Refund rejected successfully',
    data: refund,
  });
});

const completeRefund = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId, role } = req.user as { id: string; role?: string };
  const refund = await RefundService.completeRefund(req.params.id as string, { id: actorId, role }, req.ip);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Refund completed successfully',
    data: refund,
  });
});

export const RefundController = {
  createRefund,
  listRefunds,
  getRefundById,
  approveRefund,
  rejectRefund,
  completeRefund,
};