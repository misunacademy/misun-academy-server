import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PaymentService } from "./payment.service";
import { PaymentModel } from "./payment.model";
import ApiError from "../../errors/ApiError";
import { StatusCodes } from "http-status-codes";
import { Status, EnrollmentStatus } from "../../types/common";
import env from "../../config/env";
import { EnrollmentModel } from '../Enrollment/enrollment.model';

const getPaymentHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.getPaymentHistory(req.query);

  sendResponse(res, {
    statusCode: 200,
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
    statusCode: 200,
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
    statusCode: 200,
    success: true,
    message: 'Payments retrieved successfully',
    data: result,
  });
});

const checkPaymentStatus = catchAsync(async (req: Request, res: Response) => {
  const transactionId = req.query.t as string;
  const valId = (req.body?.val_id || req.query?.val_id) as string | undefined;

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Transaction ID is required");
  }

  // SSLCommerz may hit this endpoint before webhook has settled the payment.
  // Finalize immediately when callback payload includes val_id.
  if (valId) {
    try {
      await PaymentService.finalizeSSLCommerzPayment(transactionId, valId);
    } catch (error) {
      console.error('Failed to finalize payment on status callback:', error);
    }
  }

  // Get current payment status
  const result = await PaymentService.checkPaymentStatus(transactionId);

  // Redirect based on status
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

  const payment = await PaymentModel.findOne({
    transactionId,
    userId,
  }).populate({
    path: 'batchId',
    populate: {
      path: 'courseId',
      select: 'slug title',
    },
  });

  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found for this user');
  }

  if (payment.status !== Status.Success) {
    return sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: 'Payment is not successful yet',
      data: {
        verified: false,
        paymentStatus: payment.status,
      },
    });
  }

  const enrollment = payment.enrollmentId
    ? await EnrollmentModel.findOne({ enrollmentId: payment.enrollmentId })
    : null;

  const enrollmentReady =
    !!enrollment &&
    (enrollment.status === EnrollmentStatus.Active ||
      enrollment.status === EnrollmentStatus.Completed);

  return sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment verified successfully',
    data: {
      verified: enrollmentReady,
      paymentStatus: payment.status,
      courseSlug: (payment.batchId as any)?.courseId?.slug || '',
      transactionId: payment.transactionId,
    },
  });
});

/**
 * SSLCommerz payment webhook handler
 * This endpoint is called by SSLCommerz after payment
 */

// const sslCommerzWebhook = catchAsync(async (req: Request, res: Response) => {
//     const config = require('../../config/env').default;

//     const {
//         val_id,
//         tran_id,
//         status,
//         amount,
//         card_type,
//         store_amount,
//         card_issuer,
//         bank_tran_id,
//         currency,
//         tran_date,
//         verify_sign,
//         verify_key,
//     } = req.body;

//     // 2. Validate required fields
//     if (!tran_id || !status || !verify_sign || !verify_key) {
//         return sendResponse(res, {
//             statusCode: StatusCodes.BAD_REQUEST,
//             success: false,
//             message: 'Missing required fields',
//             data: null,
//         });
//     }

//     // 3. Verify signature (SSLCommerz signature verification)
//     const expectedSign = crypto
//         .createHash('md5')
//         .update(`${config.SSL_STORE_ID}${tran_id}${amount}${currency}${verify_key}`)
//         .digest('hex');

//     if (verify_sign !== expectedSign) {
//         console.error('Invalid webhook signature', { expected: expectedSign, received: verify_sign });
//         return sendResponse(res, {
//             statusCode: StatusCodes.UNAUTHORIZED,
//             success: false,
//             message: 'Invalid signature',
//             data: null,
//         });
//     }

//     // 4. Process payment atomically
//     const session = await mongoose.startSession();

//     try {
//         await session.startTransaction();

//         // Find payment by transaction ID
//         const payment = await PaymentModel.findOne({ transactionId: tran_id }).session(session);
//         if (!payment) {
//             console.error(`Payment not found for transaction: ${tran_id}`);
//             await session.abortTransaction();
//             return sendResponse(res, {
//                 statusCode: StatusCodes.NOT_FOUND,
//                 success: false,
//                 message: 'Payment not found',
//                 data: null,
//             });
//         }

//         // Update payment status based on SSLCommerz status
//         let paymentStatus: Status;
//         if (status === 'VALID' || status === 'SUCCESS') {
//             paymentStatus = Status.Success;
//         } else if (status === 'FAILED' || status === 'CANCELLED') {
//             paymentStatus = Status.Failed;
//         } else {
//             paymentStatus = Status.Pending;
//         }

//         // Update payment with gateway response
//         const gatewayResponse = {
//             val_id,
//             status,
//             amount,
//             card_type,
//             store_amount,
//             card_issuer,
//             bank_tran_id,
//             currency,
//             tran_date,
//             processedAt: new Date(),
//         };

//         payment.status = paymentStatus;
//         payment.gatewayResponse = { ...payment.gatewayResponse, ...gatewayResponse };
//         await payment.save({ session });

//         // If payment successful and enrollment exists, confirm enrollment
//         if (paymentStatus === Status.Success && payment.enrollmentId) {
//             const enrollment = await EnrollmentModel.findOne({ 
//                 enrollmentId: payment.enrollmentId 
//             }).session(session);

//             if (enrollment) {
//                 enrollment.status = EnrollmentStatus.Active;
//                 enrollment.paymentId = payment._id;
//                 enrollment.enrolledAt = new Date();
//                 await enrollment.save({ session });

//                 // Increment batch enrollment count
//                 await BatchModel.findByIdAndUpdate(
//                     payment.batchId,
//                     { $inc: { currentEnrollment: 1 } },
//                     { session }
//                 );

//                 // AUTOMATIC PROFILE CREATION/UPDATE - Single source of truth
//                 try {
//                   await ProfileService.createOrUpdateProfileAfterEnrollment(
//                     enrollment.userId.toString(),
//                     payment.enrollmentId!
//                   );
//                 } catch (profileError) {
//                   console.error('Failed to update student profile after SSLCommerz webhook:', profileError);
//                 }

//                 // Send success email
//                 const user = await UserModel.findById(payment.userId).session(session);
//                 const batch = await BatchModel.findById(payment.batchId).session(session);

//                 if (user && batch) {
//                     sendPaymentSuccessEmail(
//                         user.email,
//                         user.name,
//                         payment.amount,
//                         payment.currency || 'BDT',
//                         batch.title,
//                         payment.transactionId
//                     );

//                     // Send enrollment confirmation email
//                     sendEnrollmentConfirmationEmail(
//                         user,
//                         batch.title,
//                         enrollment.enrollmentId!,
//                         payment.amount
//                     );
//                 }
//             }
//         }

//         await session.commitTransaction();

//         console.log(`Webhook processed successfully for transaction: ${tran_id}`);

//         sendResponse(res, {
//             statusCode: StatusCodes.OK,
//             success: true,
//             message: 'Payment processed successfully',
//             data: null,
//         });

//     } catch (error) {
//         await session.abortTransaction();
//         console.error('Webhook processing error:', error);
//         throw error;
//     } finally {
//         session.endSession();
//     }
// });

export const sslCommerzWebhook = catchAsync(
  async (req: Request, res: Response) => {
    const { val_id, tran_id } = req.body;

    // 1️ Basic validation
    if (!val_id || !tran_id) {
      return sendResponse(res, {
        statusCode: StatusCodes.BAD_REQUEST,
        success: false,
        message: "Missing val_id or tran_id",
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
      console.error("SSLCommerz webhook error:", error);
      throw error;
    }
  }
);
/**
 * Initiate payment checkout
 */


/**
 * Admin: Verify manual payment
 */
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
