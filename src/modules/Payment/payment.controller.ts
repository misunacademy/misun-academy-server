import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync.js";
import sendResponse from "../../utils/sendResponse.js";
import { PaymentService } from "./payment.service.js";
import ApiError from "../../errors/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { Status } from "../../types/common.js";
import env from "../../config/env.js";
import { logger } from "../../config/logger.js";

const getPaymentHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.getPaymentHistory(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment Retrive successfully !',
    meta: result.meta,
    data: result.data,
  });
});

const updatePaymentWithEnrollStatus = catchAsync(async (req: Request, res: Response) => {
  const tran_id = req.params.tran_id as string;
  const status = req.body.status;
  if (!tran_id || !status) throw new ApiError(StatusCodes.BAD_REQUEST, "Bad Request!")

  const result = await PaymentService.updatePaymentWithEnrollStatus(tran_id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment updated successfully !',
    data: result,
  });
});

const getMyPayments = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const result = await PaymentService.getMyPayments(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payments retrieved successfully',
    data: result,
  });
});

const checkPaymentStatus = catchAsync(async (req: Request, res: Response) => {
  const transactionId = (req.query.t || req.body?.tran_id) as string;
  const valId = (req.body?.val_id || req.query?.val_id) as string | undefined;
  const callbackStatus = PaymentService.mapSslGatewayStatus((req.body?.status || req.query?.status) as string | undefined);

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Transaction ID is required");
  }

  if (valId) {
    try {
      await PaymentService.finalizeSSLCommerzPayment(transactionId, valId);
    } catch (error) {
      logger.error(error, 'Failed to finalize payment on status callback');
    }
  } else {
    const callbackKey = (req.query.k || req.body?.k) as string | undefined;
    const expectedKey = PaymentService.getStatusCallbackKey(transactionId);

    if (!callbackKey || callbackKey !== expectedKey) {
      logger.warn(
        { transactionId },
        'Status callback without val_id rejected: missing or invalid callback key'
      );
    } else if (callbackStatus) {
      try {
        const callbackPayload = Object.keys(req.body || {}).length > 0 ? req.body : req.query;

        if (callbackStatus === Status.Pending) {
          await PaymentService.updatePaymentWithEnrollStatus(transactionId, Status.Failed, callbackPayload);
        } else {
          await PaymentService.updatePaymentWithEnrollStatus(transactionId, callbackStatus, callbackPayload);
        }
      } catch (error) {
        logger.error(error, 'Failed to update payment from status callback');
      }
    } else {
      try {
        const statusCheck = await PaymentService.checkPaymentStatus(transactionId);
        if (statusCheck.payment?.status === Status.Pending && statusCheck.payment.status !== undefined) {
          await PaymentService.updatePaymentWithEnrollStatus(transactionId, Status.Failed);
        }
      } catch (error) {
        logger.error(error, 'Failed to cleanup pending payment without explicit callback status');
      }
    }
  }

  const result = await PaymentService.checkPaymentStatus(transactionId);

  return res.redirect(`${env.MA_FRONTEND_URL}${result.redirectUrl}`);
});

const verifyPaymentSuccessForCurrentUser = catchAsync(async (req: Request, res: Response) => {
  const transactionId = req.query.t as string;
  const userId = req.user?.id;

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Transaction ID is required');
  }

  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const result = await PaymentService.verifyPaymentForCurrentUser(transactionId, userId);

  return sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.verified ? 'Payment verified successfully' : 'Payment is not successful yet',
    data: result,
  });
});

export const sslCommerzWebhook = catchAsync(
  async (req: Request, res: Response) => {
    const {
      val_id,
      tran_id,
      status: sslStatus,
      amount,
      currency,
      verify_sign,
      verify_key,
    } = req.body;

    if (!val_id || !tran_id) {
      return sendResponse(res, {
        statusCode: StatusCodes.BAD_REQUEST,
        success: false,
        message: "Missing val_id or tran_id",
        data: null,
      });
    }

    if (!verify_sign || !verify_key || !amount || !currency) {
      return sendResponse(res, {
        statusCode: StatusCodes.UNAUTHORIZED,
        success: false,
        message: "Missing webhook signature params",
        data: null,
      });
    }

    const isValid = PaymentService.verifyWebhookSignature({
      status: sslStatus,
      val_id,
      tran_id,
      amount,
      currency,
      verify_key,
      verify_sign,
    });

    if (!isValid) {
      return sendResponse(res, {
        statusCode: StatusCodes.UNAUTHORIZED,
        success: false,
        message: "Invalid webhook signature",
        data: null,
      });
    }

    try {
      await PaymentService.finalizeSSLCommerzPayment(tran_id, val_id);

      return sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Payment processed successfully",
        data: null,
      });
    } catch (error) {
      logger.error(error, "SSLCommerz webhook error");
      throw error;
    }
  }
);

const verifyManualPayment = catchAsync(async (req: Request, res: Response) => {
  const { transactionId } = req.params as { transactionId: string };
  const { approved } = req.body;
  const adminId = req.user?.id;

  if (!adminId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Admin authentication required');
  }

  if (typeof approved !== 'boolean') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'approved field must be boolean');
  }

  const result = await PaymentService.verifyManualPayment(transactionId, approved, adminId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: approved ? 'Payment approved successfully' : 'Payment rejected',
    data: result,
  });
});

export const PaymentController = {
  getPaymentHistory,
  updatePaymentWithEnrollStatus,
  checkPaymentStatus,
  verifyPaymentSuccessForCurrentUser,
  getMyPayments,
  sslCommerzWebhook,
  verifyManualPayment,
}
