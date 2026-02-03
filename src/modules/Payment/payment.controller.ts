import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PaymentService } from "./payment.service";
import { PaymentModel } from "./payment.model";
import ApiError from "../../errors/ApiError";
import { StatusCodes } from "http-status-codes";
import { Status, EnrollmentStatus } from "../../types/common";
import env from "../../config/env";
import { EnrollmentService } from '../Enrollment/enrollment.service';
import { EnrollmentModel } from '../Enrollment/enrollment.model';
import { UserModel } from '../User/user.model';
import { BatchModel } from '../Batch/batch.model';
import { sendPaymentSuccessEmail, sendEnrollmentConfirmationEmail } from '../../services/emailService';
import { ProfileService } from '../Profile/profile.service';
import crypto from 'crypto';
import mongoose from 'mongoose';
import axios from "axios";
import { sslcommerzConfig } from '../../config/sslcommerz';

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
  const status = req.query.status as string;

  if (!transactionId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Transaction ID is required");
  }

  // Handle direct status updates from query params (for redirects)
  if (status) {
    let paymentStatus: Status;
    if (status === Status.Success || status === 'success') {
      paymentStatus = Status.Success;
    } else if (status === Status.Failed || status === 'failed') {
      paymentStatus = Status.Failed;
    } else if (status === Status.Cancel || status === 'cancel') {
      paymentStatus = Status.Cancel;
    } else {
      paymentStatus = Status.Pending;
    }

    await PaymentService.updatePaymentWithEnrollStatus(transactionId, paymentStatus);
  }

  // Get current payment status
  const result = await PaymentService.checkPaymentStatus(transactionId);

  // Redirect based on status
  return res.redirect(`${env.FRONTEND_URL}${result.redirectUrl}`);
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

const validateSSLCommerzPayment = async (val_id: string) => {
  const is_live = env.SSL_IS_LIVE === 'true';
  const url = is_live
    ? env.SSL_VALIDATION_API
    : "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php";

  const { data } = await axios.get(url, {
    params: {
      val_id,
      store_id: sslcommerzConfig.store_id,
      store_passwd: sslcommerzConfig.store_passwd,
      format: "json",
    },
  });

  return data;
};

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

    // 2️ Start DB session
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 3️ Find payment
      const payment = await PaymentModel.findOne({
        transactionId: tran_id,
      }).session(session);

      if (!payment) {
        await session.abortTransaction();
        return sendResponse(res, {
          statusCode: StatusCodes.NOT_FOUND,
          success: false,
          message: "Payment not found",
          data: null,
        });
      }

      // 4️ Idempotency protection
      if (payment.status === Status.Success) {
        await session.commitTransaction();
        return sendResponse(res, {
          statusCode: StatusCodes.OK,
          success: true,
          message: "Payment already processed",
          data: null,
        });
      }

      // 5️ Validate payment from SSLCommerz server
      const validation = await validateSSLCommerzPayment(val_id);

      if (
        validation.status !== "VALID" &&
        validation.status !== "VALIDATED"
      ) {
        payment.status = Status.Failed;
        await payment.save({ session });
        await session.commitTransaction();

        return sendResponse(res, {
          statusCode: StatusCodes.OK,
          success: false,
          message: "Payment validation failed",
          data: validation,
        });
      }

      // 6️ HARD verification (must match DB)
      if (
        validation.tran_id !== payment.transactionId ||
        Number(validation.amount) !== Number(payment.amount) ||
        validation.currency !== payment.currency
      ) {
        throw new Error("Payment data mismatch detected");
      }

      // 7️ Update payment
      payment.status = Status.Success;
      payment.gatewayResponse = {
        ...payment.gatewayResponse,
        val_id,
        status: validation.status,
        amount: validation.amount,
        store_amount: validation.store_amount,
        card_type: validation.card_type,
        card_issuer: validation.card_issuer,
        bank_tran_id: validation.bank_tran_id,
        currency: validation.currency,
        tran_date: validation.tran_date,
        processedAt: new Date(),
      };

      await payment.save({ session });

      // 8️ Activate enrollment
      if (payment.enrollmentId) {
        const enrollment = await EnrollmentModel.findOne({
          enrollmentId: payment.enrollmentId,
        }).session(session);

        if (enrollment) {
          enrollment.status = EnrollmentStatus.Active;
          enrollment.paymentId = payment._id;
          enrollment.enrolledAt = new Date();
          await enrollment.save({ session });

          await BatchModel.findByIdAndUpdate(
            payment.batchId,
            { $inc: { currentEnrollment: 1 } },
            { session }
          );

          // Profile update (non-blocking)
          ProfileService.createOrUpdateProfileAfterEnrollment(
            enrollment.userId.toString(),
            enrollment.enrollmentId!
          ).catch(console.error);

          // Emails
          const user = await UserModel.findById(payment.userId).session(
            session
          );
          const batch = await BatchModel.findById(payment.batchId).session(
            session
          );

          if (user && batch) {
            sendPaymentSuccessEmail(
              user.email,
              user.name,
              payment.amount,
              payment.currency || "BDT",
              batch.title,
              payment.transactionId
            );

            sendEnrollmentConfirmationEmail(
              user,
              batch.title,
              enrollment.enrollmentId!,
              payment.amount
            );
          }
        }
      }

      // 9️ Commit transaction
      await session.commitTransaction();

      return sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Payment processed successfully",
        data: null,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("SSLCommerz webhook error:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }
);
/**
 * Initiate payment checkout
 */
const initiateCheckout = catchAsync(async (req: Request, res: Response) => {
  const { enrollmentId } = req.body;
  const { id } = req.user as any;

  const enrollment = await EnrollmentModel.findOne({ enrollmentId, id })
    .populate('batchId');

  if (!enrollment) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
  }

  if (enrollment.status !== EnrollmentStatus.Pending) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Enrollment is not pending payment');
  }

  const batch = enrollment.batchId as any;

  // Create payment gateway URL
  const paymentUrl = `/api/payments/checkout/${enrollmentId}`;

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Payment checkout initiated',
    data: {
      paymentUrl,
      enrollmentId,
      amount: batch.price,
      currency: batch.currency,
    },
  });
});

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
  getMyPayments,
  sslCommerzWebhook,
  initiateCheckout,
  verifyManualPayment,
}
