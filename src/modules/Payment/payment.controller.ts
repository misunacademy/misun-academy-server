import * as Sentry from '@sentry/node';
import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync.js";
import sendResponse from "../../utils/sendResponse.js";
import { PaymentService } from "./payment.service.js";
import { runPaymentMaintenance } from "./paymentMaintenance.service.js";
import ApiError from "../../errors/ApiError.js";
import { StatusCodes } from "http-status-codes";
import env from "../../config/env.js";
import { logger } from "../../config/logger.js";

const getPaymentHistory = catchAsync(async (req: Request, res: Response) => {
  // validateRequest checks req.query but does not replace it, so coerce here:
  // $skip/$limit require real numbers, not numeric strings.
  const { page, limit, ...rest } = req.query as Record<string, unknown>;
  const result = await PaymentService.getPaymentHistory({
    ...rest,
    ...(page === undefined ? {} : { page: Number(page) }),
    ...(limit === undefined ? {} : { limit: Number(limit) }),
  });

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
  const adminId = req.user?.id;
  const reason = req.body.reason;
  if (!tran_id || !status || !adminId || !reason) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Payment status and reason are required");
  }

  const result = await PaymentService.updatePaymentWithEnrollStatus(
    tran_id,
    status,
    undefined,
    adminId,
    reason
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment updated successfully !',
    data: result,
  });
});

const getPaymentDetail = catchAsync(async (req: Request, res: Response) => {
  const transactionId = req.params.transactionId as string;
  const result = await PaymentService.getPaymentDetail(transactionId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment detail retrieved successfully',
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

const normalizeStatus = (status: string | undefined): string | undefined => {
    if (!status) return undefined;
    const lower = status.toLowerCase();
    if (/^cancel(lled|canceled)?$/.test(lower)) return 'cancel';
    if (/^fail(ed|ure)?$/.test(lower)) return 'failed';
    return undefined;
  };

  const checkPaymentStatus = catchAsync(async (req: Request, res: Response) => {
    const transactionId = (req.query.t || req.body?.tran_id) as string;
    const valId = (req.body?.val_id || req.query?.val_id) as string | undefined;

    // Decide callback intent: query param first (cancel_url has status=cancel,
    // fail_url has status=failed, success_url has none), normalized case-insensitively.
    // Only fall back to body.status when the query has none. Never let the body
    // override the query param.
    const queryStatus = normalizeStatus(req.query?.status as string | undefined);
    const bodyStatusNormalized = normalizeStatus(req.body?.status as string | undefined);
    const status = queryStatus || bodyStatusNormalized;

    if (!transactionId) {
      return res.redirect(`${env.MA_FRONTEND_URL}/payment?status=not_found`);
    }

    try {
      logger.debug(
        {
          transactionId,
          rawQueryStatus: req.query?.status,
          rawBodyStatus: req.body?.status,
          normalizedStatus: status,
        },
        'Payment status callback'
      );

      // SSLCommerz redirects the browser to cancel_url / fail_url as a POST with
      // status=cancel / status=failed. Apply the transition conditionally
      // (Pending → Cancel/Failed only), then redirect to the frontend. Never trust
      // the browser's status query param to mutate state.
      if (status === 'cancel') {
        const callbackKey = (req.query.k || req.body?.k) as string | undefined;
        const expectedKey = PaymentService.getStatusCallbackKey(transactionId);

        if (!callbackKey || callbackKey !== expectedKey) {
          return res.redirect(`${env.MA_FRONTEND_URL}/payment?status=not_found&t=${encodeURIComponent(transactionId)}`);
        }

        await PaymentService.handleCancelPayment(transactionId);
      } else if (status === 'failed') {
        const callbackKey = (req.query.k || req.body?.k) as string | undefined;
        const expectedKey = PaymentService.getStatusCallbackKey(transactionId);

        if (!callbackKey || callbackKey !== expectedKey) {
          return res.redirect(`${env.MA_FRONTEND_URL}/payment?status=not_found&t=${encodeURIComponent(transactionId)}`);
        }

        await PaymentService.handleFailPayment(transactionId);
      } else if (valId) {
        try {
          await PaymentService.finalizeSSLCommerzPayment(transactionId, valId);
        } catch (error) {
          logger.error(error, 'Failed to finalize payment on status callback');
        }
      } else {
        const callbackKey = (req.query.k || req.body?.k) as string | undefined;
        const expectedKey = PaymentService.getStatusCallbackKey(transactionId);

        if (!callbackKey || callbackKey !== expectedKey) {
          return res.redirect(`${env.MA_FRONTEND_URL}/payment?status=not_found&t=${encodeURIComponent(transactionId)}`);
        }
        // Without val_id this is only a browser redirect. Do not trust status
        // query parameters to mutate payment state; reconciliation handles
        // abandoned gateway attempts authoritatively.
      }

      const result = await PaymentService.checkPaymentStatus(transactionId);
      return res.redirect(`${env.MA_FRONTEND_URL}${result.redirectUrl}`);
    } catch (error) {
      logger.error(error, 'Payment status callback failed');
      // Never return JSON to the browser on a callback — always redirect.
      return res.redirect(
        `${env.MA_FRONTEND_URL}/payment?status=not_found&t=${encodeURIComponent(transactionId ?? '')}`
      );
    }
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
      Sentry.captureMessage('SSLCommerz webhook signature validation failed', {
        level: 'warning',
        tags: { tran_id, event: 'webhook_signature_failure' },
        extra: { val_id, tran_id, sslStatus },
      });
      return sendResponse(res, {
        statusCode: StatusCodes.UNAUTHORIZED,
        success: false,
        message: "Invalid webhook signature",
        data: null,
      });
    }

    try {
      // SSLCommerz IPN may report success (VAL/VALIDATED) or terminal failure
      // (cancelled/failed/expired). finalizeSSLCommerzPayment validates the
      // gateway and sets Success; for non-VALID statuses we apply cancel/fail
      // conditionally and never overwrite Success.
      if (sslStatus && /^(cancel|failed|cancelled|canceled|expired)$/i.test(String(sslStatus))) {
        const normalized = String(sslStatus).toLowerCase();
        if (normalized === 'cancel' || normalized === 'cancelled' || normalized === 'canceled') {
          await PaymentService.handleCancelPayment(tran_id);
        } else if (normalized === 'failed') {
          await PaymentService.handleFailPayment(tran_id);
        }
        // Expired is handled by the maintenance job, not the webhook.

        return sendResponse(res, {
          statusCode: StatusCodes.OK,
          success: true,
          message: "Payment status updated",
          data: null,
        });
      }

      await PaymentService.finalizeSSLCommerzPayment(tran_id, val_id);

      return sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Payment processed successfully",
        data: null,
      });
    } catch (error) {
      logger.error(error, "SSLCommerz webhook error");
      Sentry.captureException(error as Error, {
        level: 'error',
        tags: { tran_id, event: 'webhook_processing_failure' },
        extra: { val_id, error: error instanceof Error ? error.message : String(error) },
      });
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

const reVerifyPaymentWithGateway = catchAsync(async (req: Request, res: Response) => {
  const { tran_id } = req.params as { tran_id: string };
  const { reason } = req.body;
  const adminId = req.user?.id;

  if (!adminId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Admin authentication required');
  }

  const result = await PaymentService.reVerifyPaymentWithGateway(tran_id, adminId, reason);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment re-verified against gateway',
    data: result,
  });
});

/**
 * Cron / admin: settle payments captured at the gateway but never recorded
 * locally, then expire genuinely abandoned enrollments. Idempotent — safe to
 * run as often as the scheduler wants.
 */
const runMaintenance = catchAsync(async (_req: Request, res: Response) => {
  const result = await runPaymentMaintenance();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment maintenance completed',
    data: result,
  });
});

export const PaymentController = {
  getPaymentHistory,
  getPaymentDetail,
  updatePaymentWithEnrollStatus,
  checkPaymentStatus,
  verifyPaymentSuccessForCurrentUser,
  getMyPayments,
  sslCommerzWebhook,
  verifyManualPayment,
  reVerifyPaymentWithGateway,
  runMaintenance,
}
