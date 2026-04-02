import mongoose, { PipelineStage } from "mongoose";
import SSLCommerzPayment from 'sslcommerz-lts';
import config from '../../config/env.js';
import { PaymentModel } from "./payment.model.js";
import { Status, EnrollmentStatus } from "../../types/common.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import ApiError from "../../errors/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { UserModel } from "../User/user.model.js";
import { sendPaymentSuccessEmail, sendEnrollmentConfirmationEmail, sendPaymentFailedEmail } from "../../services/emailService.js";
import crypto from 'crypto';
import { BatchModel } from "../Batch/batch.model.js";
import { ProfileService } from "../Profile/profile.service.js";
import axios from 'axios';
import env from '../../config/env.js';
import { sslcommerzConfig } from '../../config/sslcommerz.js';
import { EnrollmentService } from "../Enrollment/enrollment.service.js";

interface PaymentHistoryQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    method?: string;
    studentId?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}

/**
 * Generate a unique transaction ID for payments
 * Format: TXN-{timestamp}-{random}
 */
const generateTransactionId = (): string => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TXN-${timestamp}-${random}`;
};

const syncProfileEnrollmentReference = async (
    userId: string,
    enrollmentId: string,
    session: mongoose.ClientSession,
    context: string
) => {
    try {
        await ProfileService.createOrUpdateProfileAfterEnrollment(
            userId,
            enrollmentId,
            session
        );
    } catch (profileError) {
        console.error(`Failed to update student profile after ${context}:`, profileError);
    }
};

const getFrontendOrigin = (urlLike?: string): string | null => {
    if (!urlLike) return null;
    try {
        return new URL(urlLike).origin;
    } catch {
        return null;
    }
};

const resolveRedirectFrontendBase = (initiatedFrom?: string): string => {
    const maOrigin = getFrontendOrigin(env.MA_FRONTEND_URL) || env.MA_FRONTEND_URL;
    const epOrigin = getFrontendOrigin(env.EP_FRONTEND_URL);
    const sourceOrigin = getFrontendOrigin(initiatedFrom);

    if (!sourceOrigin) {
        return maOrigin;
    }

    if (epOrigin && sourceOrigin === epOrigin) {
        return epOrigin;
    }

    return maOrigin;
};

const getPaymentHistory = async (query: PaymentHistoryQuery) => {
    const {
        page = 1,
        limit = 10,
        search,
        status,
        method,
        studentId,
        sortBy = "createdAt",
        sortOrder = "desc",
    } = query;

    const filters: Record<string, any> = {};

    if (status) {
        filters.status = status;
    }

    if (method) {
        filters.method = method;
    }

    if (studentId) {
        filters.userId = studentId;
    }

    const pipeline: PipelineStage[] = [
        { $match: filters },
        {
            $lookup: {
                from: "users",
                localField: "userId",
                foreignField: "_id",
                as: "user",
            },
        },
        { $unwind: "$user" },
        {
            $lookup: {
                from: "batches",
                localField: "batchId",
                foreignField: "_id",
                as: "batch",
            },
        },
        {
            $unwind: {
                path: "$batch",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $lookup: {
                from: "courses",
                localField: "batch.courseId",
                foreignField: "_id",
                as: "course",
            },
        },
        {
            $unwind: {
                path: "$course",
                preserveNullAndEmptyArrays: true
            }
        },
    ];

    // Add search stage if search query exists
    if (search) {
        pipeline.push({
            $match: {
                $or: [
                    { transactionId: { $regex: search, $options: "i" } },
                    { "user.name": { $regex: search, $options: "i" } },
                    { "user.email": { $regex: search, $options: "i" } },
                ],
            },
        });
    }

    pipeline.push(
        {
            $project: {
                transactionId: 1,
                enrollmentId: 1,
                amount: 1,
                status: 1,
                method: 1,
                createdAt: 1,
                updatedAt: 1,
                verifiedAt: 1,
                gatewayResponse: { $ifNull: ["$gatewayResponse", {}] },
                student: {
                    _id: "$user._id",
                    name: "$user.name",
                    email: "$user.email",
                    phone: "$user.phoneNumber",
                },
                batch: {
                    _id: "$batch._id",
                    title: "$batch.title",
                    batchNumber: { $concat: ["Batch #", { $toString: "$batch.batchNumber" }] }
                },
                course: {
                    _id: "$course._id",
                    title: "$course.title",
                    slug: "$course.slug",
                }
            },
        },
        {
            $sort: {
                [sortBy]: sortOrder === "asc" ? 1 : -1,
            },
        },
        {
            $skip: (page - 1) * limit,
        },
        {
            $limit: limit,
        }
    );

    const data = await PaymentModel.aggregate(pipeline);

    const totalDocuments = await PaymentModel.countDocuments(filters);

    return {
        meta: {
            total: totalDocuments,
            page,
            limit,
            totalPages: Math.ceil(totalDocuments / limit),
        },
        data,
    };
};


/**
 * Update payment status and enrollment with transaction support
 * Uses MongoDB transactions to ensure data integrity:
 * - Payment status update
 * - Enrollment status update
 * - Email notifications
 * All operations are rolled back if any step fails
 */
const updatePaymentWithEnrollStatus = async (
    transactionId: string,
    paymentStatus: Status,
    gatewayResponse?: any
) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        // 1. Find and update payment by transaction ID
        const updatedPayment = await PaymentModel.findOneAndUpdate(
            { transactionId },
            {
                status: paymentStatus,
                ...(gatewayResponse && { gatewayResponse }),
                updatedAt: new Date()
            },
            { new: true, session }
        ).populate('batchId').populate('userId');

        if (!updatedPayment) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
        }

        // 2. If payment successful and enrollment exists, confirm enrollment
        if (paymentStatus === Status.Success && updatedPayment.enrollmentId) {
            const enrollment = await EnrollmentModel.findOne({
                enrollmentId: updatedPayment.enrollmentId
            });

            if (enrollment) {
                // Confirm enrollment (activates it)
                await EnrollmentModel.findByIdAndUpdate(
                    enrollment._id,
                    {
                        status: EnrollmentStatus.Active,
                        paymentId: updatedPayment._id,
                        enrolledAt: new Date()
                    },
                    { session }
                );

                // Increment batch enrollment count
                await BatchModel.findByIdAndUpdate(
                    updatedPayment.batchId,
                    { $inc: { currentEnrollment: 1 } },
                    { session }
                );

                await syncProfileEnrollmentReference(
                    enrollment.userId.toString(),
                    updatedPayment.enrollmentId!,
                    session,
                    'SSLCommerz payment'
                );

                // Send payment success email
                const batch = updatedPayment.batchId as any;
                const user = updatedPayment.userId as any;
                if (user && batch) {
                    sendPaymentSuccessEmail(
                        user.email,
                        user.name,
                        updatedPayment.amount,
                        updatedPayment.currency || 'BDT',
                        batch?.title || 'Course',
                        updatedPayment.transactionId
                    );

                    // Send enrollment confirmation email
                    sendEnrollmentConfirmationEmail(
                        user,
                        batch?.title || 'Course',
                        updatedPayment.enrollmentId!,
                        updatedPayment.amount
                    );
                }
            }
        } else if (
            (paymentStatus === Status.Failed || paymentStatus === Status.Cancel) &&
            updatedPayment.enrollmentId
        ) {
            // Update enrollment to failed if payment failed or cancelled
            const enrollment = await EnrollmentModel.findOne({
                enrollmentId: updatedPayment.enrollmentId
            });

            if (enrollment) {
                await EnrollmentModel.findByIdAndUpdate(
                    enrollment._id,
                    { status: EnrollmentStatus.PaymentFailed },
                    { session }
                );
            }
        }

        // Commit transaction
        await session.commitTransaction();
        session.endSession();

        return {
            payment: updatedPayment,
            enrollment: updatedPayment.enrollmentId ?
                await EnrollmentModel.findOne({ enrollmentId: updatedPayment.enrollmentId }) : null,
        };
    } catch (error) {
        // Rollback transaction
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

/**
 * Update or create payment record
 */
const updatePayment = async (paymentData: {
    enrollmentId: string;
    transactionId: string;
    amount: number;
    currency: string;
    status: string;
    method: string;
    gatewayResponse?: any;
}) => {
    const enrollment = await EnrollmentModel.findOne({ enrollmentId: paymentData.enrollmentId });
    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    const payment = await PaymentModel.findOneAndUpdate(
        { enrollmentId: paymentData.enrollmentId },
        {
            userId: enrollment.userId,
            batchId: enrollment.batchId,
            enrollmentId: paymentData.enrollmentId,
            transactionId: paymentData.transactionId,
            amount: paymentData.amount,
            currency: paymentData.currency,
            status: paymentData.status,
            method: paymentData.method,
            gatewayResponse: paymentData.gatewayResponse,
        },
        { new: true, upsert: true }
    );

    return payment;
};

const checkPaymentStatus = async (transactionId: string) => {
    // Find payment record by transaction ID
    const payment = await PaymentModel.findOne({ transactionId }).populate({
        path: 'batchId',
        populate: {
            path: 'courseId',
            select: 'slug',
        },
    });
    if (!payment) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Payment data not found!");
    }

    const rawCourse = (payment.batchId as any)?.courseId;
    const courseSlug =
        (typeof rawCourse === 'object' ? rawCourse?.slug : undefined) ||
        (typeof rawCourse === 'string' ? rawCourse : '');
    const courseQuery = courseSlug ? `&course=${encodeURIComponent(courseSlug)}` : '';

    // Determine frontend redirect URL based on status
    let redirectUrl = "/";
    switch (payment.status) {
        case Status.Success:
            redirectUrl = `/payment?status=success&t=${encodeURIComponent(transactionId)}${courseQuery}`;
            break;
        case Status.Pending:
            redirectUrl = `/payment?status=pending&t=${encodeURIComponent(transactionId)}${courseQuery}`;
            break;
        case Status.Failed:
            redirectUrl = `/payment?status=failed&t=${encodeURIComponent(transactionId)}${courseQuery}`;
            break;
        case Status.Cancel:
            redirectUrl = `/payment?status=cancelled&t=${encodeURIComponent(transactionId)}${courseQuery}`;
            break;
        default:
            redirectUrl = `/payment?status=failed&t=${encodeURIComponent(transactionId)}${courseQuery}`;
    }

    return {
        redirectUrl,
        payment: {
            transactionId: payment.transactionId,
            status: payment.status,
            amount: payment.amount,
            method: payment.method,
        }
    };
};

const validateSSLCommerzPayment = async (valId: string) => {
    const isLive = env.SSL_IS_LIVE === 'true';
    const url = isLive
        ? env.SSL_VALIDATION_API
        : 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';

    const { data } = await axios.get(url, {
        params: {
            val_id: valId,
            store_id: sslcommerzConfig.store_id,
            store_passwd: sslcommerzConfig.store_passwd,
            format: 'json',
        },
    });

    return data;
};

const finalizeSSLCommerzPayment = async (transactionId: string, valId: string) => {
    const session = await mongoose.startSession();

    try {
        await session.startTransaction();

        const payment = await PaymentModel.findOne({ transactionId }).session(session);
        if (!payment) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
        }

        if (payment.status === Status.Success) {
            await session.commitTransaction();
            return payment;
        }

        const validation = await validateSSLCommerzPayment(valId);

        if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
            payment.status = Status.Failed;
            payment.gatewayResponse = {
                ...payment.gatewayResponse,
                val_id: valId,
                status: validation.status,
                processedAt: new Date(),
            };
            await payment.save({ session });
            await session.commitTransaction();
            return payment;
        }

        if (
            validation.tran_id !== payment.transactionId ||
            Number(validation.amount) !== Number(payment.amount) ||
            validation.currency !== payment.currency
        ) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment data mismatch detected');
        }

        payment.status = Status.Success;
        payment.gatewayResponse = {
            ...payment.gatewayResponse,
            val_id: valId,
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

        if (payment.enrollmentId) {
            const enrollment = await EnrollmentModel.findOne({
                enrollmentId: payment.enrollmentId,
            }).session(session);

            if (enrollment) {
                const wasAlreadyActive = enrollment.status === EnrollmentStatus.Active;

                enrollment.status = EnrollmentStatus.Active;
                enrollment.paymentId = payment._id as any;
                enrollment.enrolledAt = enrollment.enrolledAt || new Date();
                await enrollment.save({ session });

                if (!wasAlreadyActive) {
                    await BatchModel.findByIdAndUpdate(
                        payment.batchId,
                        { $inc: { currentEnrollment: 1 } },
                        { session }
                    );
                }

                await syncProfileEnrollmentReference(
                    enrollment.userId.toString(),
                    enrollment.enrollmentId!,
                    session,
                    'SSLCommerz payment finalize'
                );

                const user = await UserModel.findById(payment.userId).session(session);
                const batch = await BatchModel.findById(payment.batchId).session(session);

                if (user && batch) {
                    sendPaymentSuccessEmail(
                        user.email,
                        user.name,
                        payment.amount,
                        payment.currency || 'BDT',
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

        await session.commitTransaction();
        return payment;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Get current user's payments
 */
const getMyPayments = async (userId: string) => {
    const payments = await PaymentModel.find({ userId })
        .populate({
            path: 'batchId',
            select: 'title batchNumber courseId'
        })
        .populate({
            path: 'verifiedBy',
            select: 'name email'
        })
        .sort({ createdAt: -1 })
        .lean();

    // Populate course info from batch
    const populatedPayments = await Promise.all(
        payments.map(async (payment) => {
            const batch = payment.batchId as any;
            let course = null;
            if (batch?.courseId) {
                course = await mongoose.model('Course').findById(batch.courseId).select('title slug').lean();
            }
            return {
                ...payment,
                batch,
                course
            };
        })
    );

    return populatedPayments;
};

/**
 * Initiate SSLCommerz payment
 */
const initiateSSLCommerzPayment = async (enrollmentId: string, userId: string, initiatedFrom?: string) => {
    // const SSLCommerzPayment = require('sslcommerz-lts');
    // const config = require('../../config/env.js').default;

    const enrollment = await EnrollmentModel.findOne({ enrollmentId, userId })
        .populate('batchId')
        .populate('userId');

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    if (
        enrollment.status !== EnrollmentStatus.Pending &&
        enrollment.status !== EnrollmentStatus.PaymentPending &&
        enrollment.status !== EnrollmentStatus.PaymentFailed
    ) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Enrollment is not pending payment');
    }

    const batch = enrollment.batchId as any;
    const user = enrollment.userId as any;

    const store_id = config.SSL_STORE_ID;
    const store_passwd = config.SSL_STORE_PASSWORD;
    const is_live = config.SSL_IS_LIVE === 'true';

    if (!store_id || !store_passwd) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Payment gateway not configured');
    }

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);

    // Generate unique transaction ID
    const transactionId = generateTransactionId();
    const redirectFrontend = resolveRedirectFrontendBase(initiatedFrom);

    const paymentData = {
        store_id: config.SSL_STORE_ID,
        store_passwd: config.SSL_STORE_PASSWORD,
        total_amount: batch.price,
        currency: "BDT",
        tran_id: transactionId,
        success_url: `${redirectFrontend}/payment?status=success&t=${encodeURIComponent(transactionId)}`,
        fail_url: `${redirectFrontend}/payment?status=failed&t=${encodeURIComponent(transactionId)}`,
        cancel_url: `${redirectFrontend}/payment?status=cancelled&t=${encodeURIComponent(transactionId)}`,
        ipn_url: `${config.SERVER_URL}/api/v1/payments/webhook`,
        product_name: `Graphics Design Course - ${batch.title}`,
        cus_name: user.name,
        cus_email: user.email,
        cus_add1: user.address || 'N/A',
        cus_phone: user.phone || 'N/A',
        shipping_method: 'N/A',
        product_category: 'Online Course',
        product_profile: 'general',
        cus_add2: 'N/A',
        cus_city: 'N/A',
        cus_state: 'N/A',
        cus_postcode: 'N/A',
        cus_country: 'Bangladesh',
        cus_fax: 'N/A',
        ship_name: 'N/A',
        ship_add1: 'N/A',
        ship_add2: 'N/A',
        ship_city: 'N/A',
        ship_state: 'N/A',
        ship_postcode: 1000,
        ship_country: 'Bangladesh',
        value_a: enrollmentId,
        value_b: userId,
        value_c: batch._id.toString(),
    };
    // const paymentData = {
    //     total_amount: batch.price,
    //     currency: batch.currency || 'BDT',
    //     tran_id: transactionId, // Use generated transaction ID, not enrollment ID
    //     success_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=success`,
    //     fail_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=failed`,
    //     cancel_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=cancel`,
    //     ipn_url: `${config.SERVER_URL}/api/v1/payments/webhook`,
    //     product_name: batch.title,
    //     product_category: 'Education',
    //     product_profile: 'general',
    //     cus_name: user.name,
    //     cus_email: user.email,
    //     cus_add1: 'N/A',
    //     cus_city: 'N/A',
    //     cus_state: 'N/A',
    //     cus_postcode: 'N/A',
    //     cus_country: 'Bangladesh',
    //     cus_phone: user.phoneNumber || 'N/A',
    //     shipping_method: 'NO',
    //     multi_card_name: 'mastercard,visacard,amexcard',
    //     value_a: enrollmentId, // Store enrollment ID for reference
    //     value_b: userId,
    //     value_c: batch._id.toString(),
    // };

    // Reuse a single payment record per enrollment and rotate transaction ID per retry.
    await PaymentModel.findOneAndUpdate(
        { enrollmentId },
        {
            $set: {
                userId,
                batchId: batch._id,
                enrollmentId,
                transactionId,
                amount: batch.price,
                currency: batch.currency || 'BDT',
                status: Status.Pending,
                method: 'SSLCommerz',
                gatewayResponse: {
                    retriedAt: new Date(),
                },
            },
            $unset: {
                verifiedAt: '',
                verifiedBy: '',
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );



    try {

        const response = await sslcz.init(paymentData);
        if (response?.GatewayPageURL) {
            return {
                paymentUrl: response.GatewayPageURL,
                enrollmentId,
                transactionId, // Return the generated transaction ID
            };
        } else {
            console.error('SSLCommerz init failed. Response:', response);
            throw new ApiError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                response?.failedreason || 'Failed to initiate payment gateway. Please check SSLCommerz configuration.'
            );
        }
    } catch (error: any) {
        console.error('SSLCommerz error:', error);
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error?.message || 'Payment gateway initialization failed. Please contact support.'
        );
    }
};

/**
 * Admin: Verify and approve manual payment
 * After approval, generates and assigns enrollmentId atomically
 */
const verifyManualPayment = async (transactionId: string, approved: boolean, adminId: string) => {
    const session = await mongoose.startSession();

    try {
        await session.startTransaction();

        // Find payment by transaction ID
        const payment = await PaymentModel.findOne({ transactionId }).session(session);

        if (!payment) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
        }

        if (payment.status !== Status.Review) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment is not pending review');
        }

        if (approved) {
            // Get batch information for enrollment ID generation
            const batch = await BatchModel.findById(payment.batchId).populate('courseId').session(session);
            if (!batch) {
                throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
            }

            // Generate enrollment ID for approved payment if not already assigned to this enrollment.
            const courseSlug = (batch.courseId as any)?.slug || '';
            let enrollmentId = payment.enrollmentId;
            if (!enrollmentId) {
                enrollmentId = await EnrollmentService.generateEnrollmentId(batch?.title?.split(' ')[1], courseSlug);
            }

            // Update payment to success and link enrollment
            payment.status = Status.Success;
            payment.enrollmentId = enrollmentId;
            payment.verifiedAt = new Date();
            payment.verifiedBy = adminId as any;
            payment.gatewayResponse = {
                ...payment.gatewayResponse,
                verifiedAt: new Date(),
                verifiedBy: adminId,
            };
            await payment.save({ session });

            // Find and update enrollment
            const enrollment = await EnrollmentModel.findOne({
                userId: payment.userId,
                batchId: payment.batchId,
                status: EnrollmentStatus.PaymentPending
            }).session(session);

            if (!enrollment) {
                throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
            }

            // Assign enrollment ID if missing (existing may already have it), then activate
            if (!enrollment.enrollmentId) {
                enrollment.enrollmentId = enrollmentId;
            }
            enrollment.status = EnrollmentStatus.Active;
            enrollment.paymentId = payment._id;
            enrollment.enrolledAt = new Date();
            await enrollment.save({ session });

            // Increment batch enrollment count
            await BatchModel.findByIdAndUpdate(
                payment.batchId,
                { $inc: { currentEnrollment: 1 } },
                { session }
            );

            // Initialize module progress
            await EnrollmentService.initializeModuleProgress(enrollment._id.toString(), payment.batchId.toString());

            // Send confirmation email
            const user = await UserModel.findById(payment.userId).session(session);
            const batchForEmail = await BatchModel.findById(payment.batchId).session(session);

            if (user && batchForEmail) {
                sendPaymentSuccessEmail(
                    user.email,
                    user.name,
                    payment.amount,
                    payment.currency || 'BDT',
                    batchForEmail.title,
                    payment.transactionId
                );

                // Send enrollment confirmation email
                sendEnrollmentConfirmationEmail(
                    user,
                    batchForEmail.title,
                    enrollmentId,
                    payment.amount
                );
            }

            await syncProfileEnrollmentReference(
                enrollment.userId.toString(),
                enrollmentId,
                session,
                'manual payment approval'
            );
        } else {
            // Reject payment
            payment.status = Status.Failed;
            payment.gatewayResponse = {
                ...payment.gatewayResponse,
                rejectedAt: new Date(),
                rejectedBy: adminId,
            };
            await payment.save({ session });

            // Update enrollment to PaymentFailed
            await EnrollmentModel.findOneAndUpdate(
                {
                    userId: payment.userId,
                    batchId: payment.batchId,
                    status: EnrollmentStatus.PaymentPending
                },
                { status: EnrollmentStatus.PaymentFailed },
                { session }
            );

            // Send payment failed email
            const user = await UserModel.findById(payment.userId).session(session);
            const batch = await BatchModel.findById(payment.batchId).session(session);

            if (user && batch) {
                sendPaymentFailedEmail(
                    user,
                    batch.title,
                    'Payment verification failed by admin'
                );
            }
        }

        await session.commitTransaction();
        return payment;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

export const PaymentService = {
    getPaymentHistory,
    updatePaymentWithEnrollStatus,
    checkPaymentStatus,
    finalizeSSLCommerzPayment,
    updatePayment,
    getMyPayments,
    initiateSSLCommerzPayment,
    verifyManualPayment,
}