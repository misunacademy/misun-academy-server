import mongoose, { PipelineStage } from "mongoose";
import SSLCommerzPayment from 'sslcommerz-lts';
import config from '../../config/env.js';
import { PaymentModel } from "./payment.model.js";
import { Status, EnrollmentStatus } from "../../types/common.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import ApiError from "../../errors/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { UserModel } from "../User/user.model.js";
import {
    sendCourseEnrollmentConfirmationEmail,
    sendCoursePaymentFailedEmail,
    sendCoursePaymentSuccessEmail,
} from "../../services/courseEmailRouter.js";
import crypto from 'crypto';
import { BatchModel } from "../Batch/batch.model.js";
import { ProfileService } from "../Profile/profile.service.js";
import axios from 'axios';
import env from '../../config/env.js';
import { EnrollmentService } from "../Enrollment/enrollment.service.js";
import { logger } from "../../config/logger.js";
import { IPayment } from "./payment.model.js";

interface PaymentHistoryQuery {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    method?: string;
    courseId?: string;
    batchId?: string;
    studentId?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}

interface ActivateEnrollmentParams {
    payment: IPayment & mongoose.Document;
    enrollmentId: string;
    session: mongoose.ClientSession;
    context: string;
    initializeModules?: boolean;
}

const generateTransactionId = (): string => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `MA${timestamp}${random}`;
};

const syncProfileEnrollmentReference = async (
    userId: string,
    enrollmentId: string,
    session: mongoose.ClientSession,
    context: string
) => {
    try {
        await ProfileService.createOrUpdateProfileAfterEnrollment(userId, enrollmentId, session);
    } catch (profileError) {
        logger.error(profileError, `Failed to update student profile after ${context}`);
    }
};

const getCourseBatchLabel = (batch: any): string => {
    const batchTitle = (batch?.title || '').toString().trim();
    const courseTitle = typeof batch?.courseId === 'object'
        ? (batch.courseId?.title || '').toString().trim()
        : '';

    if (courseTitle && batchTitle) {
        return `${courseTitle} - ${batchTitle}`;
    }

    return courseTitle || batchTitle || 'Course';
};

const getCourseEmailContext = (batch: any): { courseName: string; courseSlug: string } => {
    const rawCourse = typeof batch?.courseId === 'object' ? batch.courseId : null;
    return {
        courseName: (rawCourse?.title || getCourseBatchLabel(batch)).toString(),
        courseSlug: (rawCourse?.slug || '').toString(),
    };
};

// ─── SHARED ACTIVATION LOGIC (replaces 3x duplicated code) ───

const sendPaymentSuccessNotifications = async (
    user: any,
    batch: any,
    payment: IPayment & mongoose.Document,
    enrollmentId: string,
) => {
    const courseWithBatch = getCourseBatchLabel(batch);
    const courseEmailContext = getCourseEmailContext(batch);

    sendCoursePaymentSuccessEmail(
        courseEmailContext,
        user.email,
        user.name,
        payment.amount,
        payment.currency || 'BDT',
        courseWithBatch,
        payment.transactionId,
        payment.method
    );

    sendCourseEnrollmentConfirmationEmail(
        courseEmailContext,
        user,
        courseWithBatch,
        enrollmentId,
        payment.amount,
        payment.method
    );
};

const sendPaymentFailedNotifications = async (
    user: any,
    batch: any,
    failureReason: string,
) => {
    const courseWithBatch = getCourseBatchLabel(batch);
    const courseEmailContext = getCourseEmailContext(batch);

    sendCoursePaymentFailedEmail(
        courseEmailContext,
        user,
        courseWithBatch,
        failureReason
    );
};

const activateEnrollmentForPayment = async (params: ActivateEnrollmentParams) => {
    const { payment, enrollmentId, session, context, initializeModules } = params;

    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).session(session);
    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found for activation');
    }

    const wasAlreadyActive = enrollment.status === EnrollmentStatus.Active;

    enrollment.status = EnrollmentStatus.Active;
    enrollment.paymentId = payment._id as any;
    enrollment.enrolledAt = enrollment.enrolledAt || new Date();
    await enrollment.save({ session });

    await EnrollmentService.ensureStudentIdForUser(enrollment.userId.toString(), session);

    if (!wasAlreadyActive) {
        await BatchModel.findByIdAndUpdate(
            payment.batchId,
            { $inc: { currentEnrollment: 1 } },
            { session }
        );
    }

    if (initializeModules) {
        await EnrollmentService.initializeModuleProgress(enrollment._id.toString());
    }

    await syncProfileEnrollmentReference(
        enrollment.userId.toString(),
        enrollment.enrollmentId!,
        session,
        context
    );

    const user = await UserModel.findById(payment.userId).lean().session(session);
    const batch = await BatchModel.findById(payment.batchId)
        .populate('courseId', 'title slug')
        .lean()
        .session(session);

    if (user && batch) {
        await sendPaymentSuccessNotifications(user, batch, payment, enrollmentId);
    }

    return enrollment;
};

const failEnrollment = async (
    payment: IPayment & mongoose.Document,
    session: mongoose.ClientSession,
    failureReason: string,
) => {
    if (payment.enrollmentId) {
        await EnrollmentModel.findOneAndUpdate(
            { enrollmentId: payment.enrollmentId },
            { status: EnrollmentStatus.PaymentFailed },
            { session }
        );
    }

    const user = await UserModel.findById(payment.userId).lean().session(session);
    const batch = await BatchModel.findById(payment.batchId)
        .populate('courseId', 'title slug')
        .lean()
        .session(session);

    if (user && batch) {
        await sendPaymentFailedNotifications(user, batch, failureReason);
    }
};

// ─── PAYMENT HISTORY ───

const getPaymentHistory = async (query: PaymentHistoryQuery) => {
    const {
        page = 1,
        limit = 10,
        search,
        status,
        method,
        courseId,
        batchId,
        studentId,
        sortBy = "createdAt",
        sortOrder = "desc",
    } = query;

    const filters: Record<string, unknown> = {};

    if (status) filters.status = status;
    if (method) filters.method = method;
    if (studentId) filters.userId = studentId;

    let filteredBatchIds: mongoose.Types.ObjectId[] | null = null;

    if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid courseId");
        }

        const batchIds = await BatchModel.find({
            courseId: new mongoose.Types.ObjectId(courseId),
        }).distinct("_id");

        filteredBatchIds = batchIds.map((id) => new mongoose.Types.ObjectId(id));
    }

    if (batchId) {
        if (!mongoose.Types.ObjectId.isValid(batchId)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid batchId");
        }

        const selectedBatchId = new mongoose.Types.ObjectId(batchId);
        if (filteredBatchIds) {
            filteredBatchIds = filteredBatchIds.filter((id) => id.toString() === selectedBatchId.toString());
        } else {
            filters.batchId = selectedBatchId;
        }
    }

    if (filteredBatchIds) {
        filters.batchId = { $in: filteredBatchIds };
    }

    const pipeline: PipelineStage[] = [
        { $match: filters as any },
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

    if (search) {
        pipeline.push({
            $match: {
                $or: [
                    { transactionId: { $regex: search, $options: "i" } },
                    { "user.name": { $regex: search, $options: "i" } },
                    { "user.email": { $regex: search, $options: "i" } },
                ],
            },
        } as any);
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

// ─── PAYMENT STATUS UPDATE WITH ENROLLMENT ───

const updatePaymentWithEnrollStatus = async (
    transactionId: string,
    paymentStatus: Status,
    gatewayResponse?: unknown
) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const updateFields: Record<string, unknown> = {
            status: paymentStatus,
            updatedAt: new Date(),
        };
        if (gatewayResponse) {
            updateFields.gatewayResponse = gatewayResponse;
        }

        const updatedPayment = await PaymentModel.findOneAndUpdate(
            { transactionId },
            updateFields,
            { new: true, session }
        ).populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title slug' }
        }).populate('userId');

        if (!updatedPayment) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
        }

        if (paymentStatus === Status.Success && updatedPayment.enrollmentId) {
            await activateEnrollmentForPayment({
                payment: updatedPayment,
                enrollmentId: updatedPayment.enrollmentId,
                session,
                context: 'payment status update',
                initializeModules: false,
            });
        } else if (
            (paymentStatus === Status.Failed || paymentStatus === Status.Cancel) &&
            updatedPayment.enrollmentId
        ) {
            await failEnrollment(
                updatedPayment,
                session,
                'Payment ' + paymentStatus
            );
        }

        await session.commitTransaction();
        session.endSession();

        return {
            payment: updatedPayment,
            enrollment: updatedPayment.enrollmentId
                ? await EnrollmentModel.findOne({ enrollmentId: updatedPayment.enrollmentId }).lean()
                : null,
        };
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

// ─── UPSERT PAYMENT ───

const updatePayment = async (paymentData: {
    enrollmentId: string;
    transactionId: string;
    amount: number;
    currency: string;
    status: string;
    method: string;
    gatewayResponse?: unknown;
}) => {
    const enrollment = await EnrollmentModel.findOne({ enrollmentId: paymentData.enrollmentId }).lean();
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

// ─── CHECK PAYMENT STATUS ───

const checkPaymentStatus = async (transactionId: string) => {
    const payment = await PaymentModel.findOne({ transactionId }).lean().populate({
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

    let redirectUrl: string;
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

// ─── SSLCOMMERZ VALIDATION ───

const validateSSLCommerzPayment = async (valId: string) => {
    const { data } = await axios.get(env.SSL_VALIDATION_API, {
        params: {
            val_id: valId,
            store_id: env.SSL_STORE_ID,
            store_passwd: env.SSL_STORE_PASSWORD,
            format: 'json',
        },
    });

    return data;
};

// ─── FINALIZE SSLCOMMERZ PAYMENT ───

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

            if (payment.enrollmentId) {
                await failEnrollment(payment, session, 'SSLCommerz validation failed');
            }

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
            await activateEnrollmentForPayment({
                payment,
                enrollmentId: payment.enrollmentId,
                session,
                context: 'SSLCommerz payment finalize',
                initializeModules: false,
            });
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

// ─── GET MY PAYMENTS ───

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

    const batchIds = payments
        .map((p) => (p.batchId as any)?.courseId)
        .filter(Boolean);

    const courses = await mongoose.model('Course').find({
        _id: { $in: batchIds }
    }).select('title slug').lean();

    const courseMap = new Map(courses.map((c: any) => [c._id.toString(), c]));

    return payments.map((payment) => {
        const batch = payment.batchId as any;
        const courseId = batch?.courseId?.toString();
        const course = courseId ? courseMap.get(courseId) : null;
        return { ...payment, batch, course };
    });
};

// ─── INITIATE SSLCOMMERZ PAYMENT ───

const initiateSSLCommerzPayment = async (enrollmentId: string, userId: string) => {
    const enrollment = await EnrollmentModel.findOne({ enrollmentId, userId })
        .lean()
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

    const batch = enrollment.batchId;
    const user = enrollment.userId;

    const store_id = config.SSL_STORE_ID;
    const store_passwd = config.SSL_STORE_PASSWORD;
    const is_live = config.SSL_IS_LIVE === 'true';

    if (!store_id || !store_passwd) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Payment gateway not configured');
    }

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const transactionId = generateTransactionId();

    const paymentData = {
        store_id: config.SSL_STORE_ID,
        store_passwd: config.SSL_STORE_PASSWORD,
        total_amount: Number((batch as any).price).toFixed(2),
        currency: "BDT",
        tran_id: transactionId,
        success_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}`,
        fail_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=failed`,
        cancel_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=cancel`,
        ipn_url: `${config.SERVER_URL}/api/v1/payments/webhook`,
        product_name: getCourseBatchLabel(batch),
        cus_name: (user as any).name,
        cus_email: (user as any).email,
        cus_add1: (user as any).address || 'N/A',
        cus_phone: (user as any).phone || 'N/A',
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
        value_c: (batch as any)._id.toString(),
    };

    await PaymentModel.findOneAndUpdate(
        { enrollmentId },
        {
            $set: {
                userId,
                batchId: (batch as any)._id,
                enrollmentId,
                transactionId,
                amount: (batch as any).price,
                currency: (batch as any).currency || 'BDT',
                status: Status.Pending,
                method: 'SSLCommerz',
                gatewayResponse: { retriedAt: new Date() },
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
                transactionId,
            };
        } else {
            logger.error({ response }, 'SSLCommerz init failed');
            throw new ApiError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                response?.failedreason || 'Failed to initiate payment gateway. Please check SSLCommerz configuration.'
            );
        }
    } catch (error: any) {
        logger.error(error, 'SSLCommerz error');
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error?.message || 'Payment gateway initialization failed. Please contact support.'
        );
    }
};

// ─── VERIFY MANUAL PAYMENT ───

const verifyManualPayment = async (transactionId: string, approved: boolean, adminId: string) => {
    const session = await mongoose.startSession();

    try {
        await session.startTransaction();

        const payment = await PaymentModel.findOne({ transactionId }).session(session);
        if (!payment) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
        }

        if (payment.status !== Status.Review) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment is not pending review');
        }

        if (approved) {
            const batch = await BatchModel.findById(payment.batchId).populate('courseId').lean().session(session);
            if (!batch) {
                throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
            }

            const courseSlug = (batch.courseId as any)?.slug || '';
            let enrollmentId = payment.enrollmentId;
            if (!enrollmentId) {
                enrollmentId = await EnrollmentService.generateEnrollmentId(
                    (batch as any).title?.split(' ')[1],
                    courseSlug
                );
            }

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

            await activateEnrollmentForPayment({
                payment,
                enrollmentId,
                session,
                context: 'manual payment approval',
                initializeModules: true,
            });
        } else {
            payment.status = Status.Failed;
            payment.gatewayResponse = {
                ...payment.gatewayResponse,
                rejectedAt: new Date(),
                rejectedBy: adminId,
            };
            await payment.save({ session });

            await failEnrollment(payment, session, 'Payment verification failed by admin');
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

// ─── SSLCOMMERZ WEBHOOK SIGNATURE VERIFICATION ───

const verifyWebhookSignature = (params: {
    status: string;
    val_id: string;
    tran_id: string;
    amount: string;
    currency: string;
    verify_key: string;
    verify_sign: string;
}): boolean => {
    const keys = params.verify_key.split(',');
    let concatString = env.SSL_STORE_PASSWORD;
    for (const key of keys) {
        concatString += (params as any)[key] || '';
    }
    const expectedSign = crypto
        .createHash('md5')
        .update(concatString)
        .digest('hex');
    return params.verify_sign === expectedSign;
};

// ─── SSLCOMMERZ GATEWAY STATUS MAPPER ───

const mapSslGatewayStatus = (rawStatus?: string): Status | null => {
    if (!rawStatus) return null;

    const normalized = rawStatus.toString().trim().toUpperCase();

    if (['FAILED', 'FAIL', 'FAILED_CARD', 'INVALID_TRANSACTION'].includes(normalized)) {
        return Status.Failed;
    }

    if (['CANCELLED', 'CANCELED', 'CANCEL'].includes(normalized)) {
        return Status.Cancel;
    }

    if (['PENDING', 'PROCESSING', 'INITIATED'].includes(normalized)) {
        return Status.Pending;
    }

    return null;
};

// ─── VERIFY PAYMENT FOR CURRENT USER ───

const verifyPaymentForCurrentUser = async (transactionId: string, userId: string) => {
    const payment = await PaymentModel.findOne({
        transactionId,
        userId,
    }).lean().populate({
        path: 'batchId',
        populate: {
            path: 'courseId',
            select: 'slug title',
        },
    });

    if (!payment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found for this user');
    }

    let verified = false;
    if (payment.status === Status.Success && payment.enrollmentId) {
        const enrollment = await EnrollmentModel.findOne({ enrollmentId: payment.enrollmentId }).lean();
        verified = !!enrollment && (
            enrollment.status === EnrollmentStatus.Active ||
            enrollment.status === EnrollmentStatus.Completed
        );
    }

    return {
        verified,
        paymentStatus: payment.status,
        courseSlug: (payment.batchId as any)?.courseId?.slug || '',
        transactionId: payment.transactionId,
    };
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
    verifyWebhookSignature,
    mapSslGatewayStatus,
    verifyPaymentForCurrentUser,
};
