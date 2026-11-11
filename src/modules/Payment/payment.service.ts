import mongoose, { PipelineStage } from "mongoose";
import config from '../../config/env.js';
import { PaymentModel } from "./payment.model.js";
import { PaymentAttemptModel } from "./paymentAttempt.model.js";
import { Status, EnrollmentStatus } from "../../types/common.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import { EnrollmentStatusHistoryModel } from "../Enrollment/enrollmentStatusHistory.model.js";
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
import { paymentGatewayAdapter } from '../../services/paymentGatewayAdapter.js';
import { EnrollmentService } from "../Enrollment/enrollment.service.js";
import { logger } from "../../config/logger.js";
import { deriveCourseBrand } from "../../utils/courseBrand.js";
import { recordAudit } from "../../models/auditLog.model.js";
import { IPayment } from "./payment.model.js";
import { NotificationService } from '../Notification/notification.service.js';
import { EnrollmentPerkService } from '../EnrollmentPerk/enrollmentPerk.service.js';
import * as Sentry from '@sentry/node';

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
    actorType?: 'user' | 'admin' | 'system' | 'gateway' | 'cron';
    actorId?: string;
}

/**
 * Post-commit notification work. Built inside the transaction (where the
 * user/batch rows are consistent) but flushed only AFTER commit, so a
 * "Payment Successful" email can never go out for a rolled-back payment —
 * and slow sends never hold a DB transaction open.
 */
type PaymentNotifyIntent =
    | {
        kind: 'success';
        user: any;
        batch: any;
        payment: { _id: unknown; amount: number; currency?: string; transactionId: string; method: string };
        enrollmentId: string;
    }
    | { kind: 'failed'; user: any; batch: any; reason: string; paymentId: unknown }
    | {
        kind: 'review';
        paymentId: unknown;
        transactionId: string;
        enrollmentId: string;
        reason: string;
    };

const flushPaymentNotify = async (intent: PaymentNotifyIntent | null) => {
    if (!intent) return;
    if (intent.kind === 'success') {
        await sendPaymentSuccessNotifications(intent.user, intent.batch, intent.payment as any, intent.enrollmentId);
        try {
            await NotificationService.createNotification({
                userId: intent.user._id.toString(),
                type: 'payment_success',
                title: 'Payment Successful',
                message: `Your payment of ${intent.payment.amount} ${intent.payment.currency || 'BDT'} has been confirmed. Welcome to ${getCourseBatchLabel(intent.batch)}!`,
                link: '/my-classes',
                relatedTo: { model: 'Payment', id: intent.payment._id!.toString() },
            });
        } catch (error) {
            logger.error(error, 'Failed to send payment success notification');
        }
    } else if (intent.kind === 'failed') {
        await sendPaymentFailedNotifications(intent.user, intent.batch, intent.reason);
        try {
            await NotificationService.createNotification({
                userId: intent.user._id.toString(),
                type: 'payment_failed',
                title: 'Payment Failed',
                message: `Your payment for ${getCourseBatchLabel(intent.batch)} was not completed. Reason: ${intent.reason}`,
                link: '/payment',
                relatedTo: { model: 'Payment', id: intent.paymentId!.toString() },
            });
        } catch (error) {
            logger.error(error, 'Failed to send payment failed notification');
        }
    } else {
        try {
            await NotificationService.createNotificationForAdmins({
                type: 'payment_review',
                title: 'Payment Requires Review',
                message: `Payment ${intent.transactionId} requires review because enrollment ${intent.enrollmentId} is ${intent.reason}.`,
                link: `/dashboard/admin/payments/${encodeURIComponent(intent.transactionId)}`,
                relatedTo: { model: 'Payment', id: intent.paymentId!.toString() },
            });
        } catch (error) {
            logger.error(error, 'Failed to send payment review notification');
        }
    }
};

const generateTransactionId = (): string => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(12).toString('hex').toUpperCase();
    return `MA${timestamp}${random}`;
};

const getStatusCallbackKey = (transactionId: string): string =>
    crypto
        .createHmac('sha256', env.SSL_STORE_PASSWORD || env.BETTER_AUTH_SECRET)
        .update(transactionId)
        .digest('hex')
        .slice(0, 32);

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

const getCourseEmailContext = (batch: any): { brand?: string; courseName: string; courseSlug: string } => {
    const rawCourse = typeof batch?.courseId === 'object' ? batch.courseId : null;
    return {
        brand: rawCourse?.brand,
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

    try {
        await sendCoursePaymentSuccessEmail(
            courseEmailContext,
            user.email,
            user.name,
            payment.amount,
            payment.currency || 'BDT',
            courseWithBatch,
            payment.transactionId,
            payment.method
        );

        await sendCourseEnrollmentConfirmationEmail(
            courseEmailContext,
            user,
            courseWithBatch,
            enrollmentId,
            payment.amount,
            payment.method
        );
    } catch (error) {
        logger.error(error, 'Failed to queue payment success emails (non-blocking)');
    }
};

const sendPaymentFailedNotifications = async (
    user: any,
    batch: any,
    failureReason: string,
) => {
    const courseWithBatch = getCourseBatchLabel(batch);
    const courseEmailContext = getCourseEmailContext(batch);

    try {
        await sendCoursePaymentFailedEmail(
            courseEmailContext,
            user,
            courseWithBatch,
            failureReason
        );
    } catch (error) {
        logger.error(error, 'Failed to queue payment failed email (non-blocking)');
    }
};

const settlePaymentSuccess = async (params: {
    payment: IPayment & mongoose.Document;
    session: mongoose.ClientSession;
    context: string;
    actorType?: 'user' | 'admin' | 'system' | 'gateway' | 'cron';
    actorId?: string;
    initializeModules?: boolean;
}): Promise<{ enrollment: any; notify: PaymentNotifyIntent | null }> => {
    const { payment, session, context, actorType = 'gateway', actorId, initializeModules } = params;

    // Find the enrollment via the stable ObjectId link (enrollmentRef), never
    // the MA- string — the MA- id is not assigned until this very transaction.
    const enrollment = await EnrollmentModel.findById(payment.enrollmentRef).session(session);
    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found for payment settlement');
    }

    const batchForId = await BatchModel.findById(enrollment.batchId)
        .populate('courseId')
        .session(session)
        .lean();
    if (!batchForId) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for enrollment');
    }
    const batchNumber = EnrollmentService.parseBatchNumber(batchForId as any);
    const courseBrand = deriveCourseBrand((batchForId as any)?.courseId);

    // Generate enrollment ID (atomic $inc on EnrollmentCounterModel) inside the
    // transaction so an abort rolls the counter back too.
    const newEnrollmentId = await EnrollmentService.generateEnrollmentId(batchNumber, courseBrand, session);

    // Set enrollmentId on the payment (partial unique index — first write wins).
    payment.enrollmentId = newEnrollmentId;
    await payment.save({ session });

    // Activate enrollment: set status Active, enrollmentId, paymentId.
    const updatedEnrollment = await EnrollmentModel.findOneAndUpdate(
        {
            _id: enrollment._id,
            status: {
                $in: [
                    EnrollmentStatus.PaymentPending,
                    EnrollmentStatus.Pending,
                    EnrollmentStatus.PaymentFailed,
                    EnrollmentStatus.Expired,
                    EnrollmentStatus.Active,
                ],
            },
        },
        {
            $set: {
                status: EnrollmentStatus.Active,
                enrollmentId: newEnrollmentId,
                paymentId: payment._id,
                enrolledAt: enrollment.enrolledAt || new Date(),
            },
        },
        { new: true, session }
    );

    if (!updatedEnrollment) {
        throw new ApiError(StatusCodes.CONFLICT, 'Enrollment changed while payment was activating');
    }

    // Append-only status history inside the same transaction.
    await EnrollmentStatusHistoryModel.create([
        {
            enrollmentId: updatedEnrollment._id,
            userId: updatedEnrollment.userId,
            batchId: updatedEnrollment.batchId as mongoose.Types.ObjectId,
            from: enrollment.status,
            to: EnrollmentStatus.Active,
            actorType: actorType as 'user' | 'admin' | 'system' | 'gateway' | 'cron',
            actorId: actorId ? new mongoose.Types.ObjectId(actorId) : undefined,
            reason: `Payment verified via ${context}`,
            source: context,
            paymentId: payment._id,
        },
    ], { session });

    await EnrollmentService.ensureStudentIdForUser(updatedEnrollment.userId.toString(), session);

    if (initializeModules) {
        await EnrollmentService.initializeModuleProgress(updatedEnrollment._id.toString());
    }

    try {
        await EnrollmentPerkService.grantPerksForEnrollment({
            enrollmentId: updatedEnrollment._id.toString(),
            session,
            actor: actorId ? { id: actorId, role: actorType } : undefined,
        });
    } catch (perkErr) {
        logger.error(perkErr, 'Failed to evaluate perks during payment settlement');
    }

    const user = await UserModel.findById(payment.userId).lean().session(session);
    const batch = await BatchModel.findById(payment.batchId)
        .populate('courseId', 'title slug')
        .lean()
        .session(session);

    const notify: PaymentNotifyIntent | null =
        user && batch
            ? {
                kind: 'success',
                user,
                batch,
                payment: {
                    _id: payment._id,
                    amount: payment.amount,
                    currency: payment.currency,
                    transactionId: payment.transactionId,
                    method: payment.method,
                },
                enrollmentId: newEnrollmentId,
            }
            : null;

    logger.info(
        {
            event: 'payment.settled',
            tran_id: payment.transactionId,
            enrollmentId: newEnrollmentId,
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            status: Status.Success,
            context,
        },
        'Payment settled via shared settlement path'
    );

    return { enrollment: updatedEnrollment, notify };
};

 const activateEnrollmentForPayment = async (params: ActivateEnrollmentParams) => {
    const { payment, enrollmentId, session, context, initializeModules, actorType = 'gateway', actorId } = params;

    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).session(session);
    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found for activation');
    }

    const recoverableStatuses = [
        EnrollmentStatus.Pending,
        EnrollmentStatus.PaymentPending,
        EnrollmentStatus.PaymentFailed,
        EnrollmentStatus.Expired,
        EnrollmentStatus.Active,
    ];
    const reviewStatuses = [
        EnrollmentStatus.Refunded,
        EnrollmentStatus.Suspended,
        EnrollmentStatus.Completed,
    ];

    if (reviewStatuses.includes(enrollment.status)) {
        const reason = enrollment.status;
        payment.status = Status.Review;
        payment.gatewayResponse = {
            ...payment.gatewayResponse,
            reviewRequired: true,
            reviewReason: `Enrollment is ${reason}`,
            reviewAt: new Date(),
        };
        await payment.save({ session });

        logger.warn(
            {
                event: 'payment.activation_review',
                transactionId: payment.transactionId,
                enrollmentId,
                enrollmentStatus: enrollment.status,
            },
            'Verified payment requires manual review because enrollment is not activatable'
        );

        return {
            enrollment,
            notify: {
                kind: 'review' as const,
                paymentId: payment._id,
                transactionId: payment.transactionId,
                enrollmentId,
                reason,
            },
        };
    }

    const updatedEnrollment = await EnrollmentModel.findOneAndUpdate(
        { _id: enrollment._id, status: { $in: recoverableStatuses } },
        {
            $set: {
                status: EnrollmentStatus.Active,
                paymentId: payment._id,
                enrolledAt: enrollment.enrolledAt || new Date(),
                ...(enrollment.status === EnrollmentStatus.Expired ||
                enrollment.status === EnrollmentStatus.PaymentFailed
                    ? { statusChangeReason: `Recovered after verified payment (${context})` }
                    : {}),
            },
        },
        { new: true, session }
    );

    if (!updatedEnrollment) {
        throw new ApiError(StatusCodes.CONFLICT, 'Enrollment changed while payment was activating');
    }

    // Append-only status history inside the same transaction
    await EnrollmentStatusHistoryModel.create([
        {
            enrollmentId: updatedEnrollment._id,
            userId: updatedEnrollment.userId,
            batchId: updatedEnrollment.batchId as mongoose.Types.ObjectId,
            from: enrollment.status,
            to: EnrollmentStatus.Active,
            actorType: actorType as 'user' | 'admin' | 'system' | 'gateway' | 'cron',
            actorId: actorId ? new mongoose.Types.ObjectId(actorId) : undefined,
            reason: `Payment verified via ${context}`,
            source: context,
            paymentId: payment._id,
        },
    ], { session });

    const _wasAlreadyActive = enrollment.status === EnrollmentStatus.Active;

    await EnrollmentService.ensureStudentIdForUser(updatedEnrollment.userId.toString(), session);

    // Seat counter deprecated: use EnrollmentService.countActiveEnrollments() instead.
    // Removed $inc { currentEnrollment: 1 } to avoid drift.

    if (initializeModules) {
        await EnrollmentService.initializeModuleProgress(updatedEnrollment._id.toString());
    }

    try {
        await EnrollmentPerkService.grantPerksForEnrollment({
            enrollmentId: updatedEnrollment._id.toString(),
            session,
            actor: actorId ? { id: actorId, role: actorType } : undefined,
        });
    } catch (perkErr) {
        logger.error(perkErr, 'Failed to evaluate perks during payment settlement');
    }

    await syncProfileEnrollmentReference(
        updatedEnrollment.userId.toString(),
        updatedEnrollment.enrollmentId!,
        session,
        context
    );

    const user = await UserModel.findById(payment.userId).lean().session(session);
    const batch = await BatchModel.findById(payment.batchId)
        .populate('courseId', 'title slug')
        .lean()
        .session(session);

    // Notifications are NOT sent here — the caller flushes the returned
    // intent after the transaction commits (see flushPaymentNotify).
    const notify: PaymentNotifyIntent | null =
        user && batch
            ? {
                kind: 'success',
                user,
                batch,
                payment: {
                    _id: payment._id,
                    amount: payment.amount,
                    currency: payment.currency,
                    transactionId: payment.transactionId,
                    method: payment.method,
                },
                enrollmentId,
            }
            : null;

    return { enrollment: updatedEnrollment, notify };
};

export const failEnrollment = async (
    payment: IPayment & mongoose.Document,
    session: mongoose.ClientSession,
    failureReason: string,
): Promise<PaymentNotifyIntent | null> => {
    // Locate the enrollment via the stable ObjectId link (enrollmentRef),
    // never the MA- string which may not exist yet.
    if (payment.enrollmentRef) {
        const enrollment = await EnrollmentModel.findById(payment.enrollmentRef).session(session).lean();
        if (enrollment && enrollment.status !== EnrollmentStatus.PaymentFailed) {
            await EnrollmentService.transitionEnrollment(
                enrollment._id.toString(),
                enrollment.status as EnrollmentStatus,
                EnrollmentStatus.PaymentFailed,
                { id: payment.userId.toString(), role: 'system' },
                failureReason,
                session
            );
        }
    }

    const user = await UserModel.findById(payment.userId).lean().session(session);
    const batch = await BatchModel.findById(payment.batchId)
        .populate('courseId', 'title slug')
        .lean()
        .session(session);

    if (!user || !batch) return null;

    return { kind: 'failed', user, batch, reason: failureReason, paymentId: payment._id };
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
    // Validated as 24-hex by paymentHistoryQuerySchema — cast to ObjectId so
    // the aggregation actually matches (a raw string never equals ObjectId).
    if (studentId) filters.userId = new mongoose.Types.ObjectId(studentId);

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
        const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = { $regex: escaped, $options: 'i' };
        pipeline.push({
            $match: {
                $or: [
                    { transactionId: searchRegex },
                    { "user.name": searchRegex },
                    { "user.email": searchRegex },
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
                    phone: "$user.phone",
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

// ─── PAYMENT DETAIL (ADMIN DRILLDOWN) ───

const getPaymentDetail = async (transactionId: string) => {
    const pipeline: PipelineStage[] = [
        { $match: { transactionId } },
        {
            $lookup: {
                from: "users",
                localField: "userId",
                foreignField: "_id",
                as: "user",
            },
        },
        {
            $unwind: {
                path: "$user",
                preserveNullAndEmptyArrays: true,
            },
        },
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
                preserveNullAndEmptyArrays: true,
            },
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
                preserveNullAndEmptyArrays: true,
            },
        },
        {
            $project: {
                transactionId: 1,
                enrollmentId: 1,
                amount: 1,
                currency: 1,
                status: 1,
                method: 1,
                createdAt: 1,
                updatedAt: 1,
                verifiedAt: 1,
                paidAt: 1,
                gatewayResponse: { $ifNull: ["$gatewayResponse", {}] },
                student: {
                    _id: "$user._id",
                    name: "$user.name",
                    email: "$user.email",
                    phone: "$user.phone",
                },
                batch: {
                    _id: "$batch._id",
                    title: "$batch.title",
                    batchNumber: { $concat: ["Batch #", { $toString: "$batch.batchNumber" }] },
                },
                course: {
                    _id: "$course._id",
                    title: "$course.title",
                    slug: "$course.slug",
                },
            },
        },
    ];

    const [payment] = await PaymentModel.aggregate(pipeline);
    if (!payment) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
    }

    const enrollment = payment.enrollmentRef
        ? await EnrollmentModel.findById(payment.enrollmentRef)
              .select("enrollmentId status createdAt")
              .lean()
        : null;

    return { payment, enrollment };
};

// ─── PAYMENT STATUS UPDATE WITH ENROLLMENT ───

const updatePaymentWithEnrollStatus = async (
    transactionId: string,
    paymentStatus: Status,
    gatewayResponse?: unknown,
    adminId?: string,
    reason?: string
) => {
    if (paymentStatus === Status.Success || paymentStatus === Status.Refunded) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Paid and refunded states can only be set by their verified settlement flows'
        );
    }

    if (!adminId || !reason?.trim()) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'An administrator and reason are required for payment status changes'
        );
    }

    Sentry.captureMessage('Admin-initiated payment status change', {
        level: 'warning',
        tags: { paymentStatus, transactionId },
        extra: { adminId, reason },
    });

    const session = await mongoose.startSession();
    let notify: PaymentNotifyIntent | null = null;

    try {
        session.startTransaction();

        const updateFields: Record<string, unknown> = {
            status: paymentStatus,
            updatedAt: new Date(),
        };
        if (gatewayResponse) {
            updateFields.gatewayResponse = gatewayResponse;
        }

        const existingPayment = await PaymentModel.findOne({ transactionId }).session(session);
        if (!existingPayment) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Payment not found");
        }

        const updatedPayment = await PaymentModel.findOneAndUpdate(
            {
                transactionId,
                status: { $in: [Status.Pending, Status.Review, Status.Risk] },
            },
            {
                ...updateFields,
                $push: {
                    'gatewayResponse.adminStatusHistory': {
                        from: existingPayment.status,
                        to: paymentStatus,
                        reason: reason.trim(),
                        adminId,
                        changedAt: new Date(),
                    },
                },
            },
            { new: true, session }
        ).populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title slug' }
        }).populate('userId');

        if (!updatedPayment) {
            throw new ApiError(StatusCodes.CONFLICT, "Payment status changed or is terminal");
        }

        await recordAudit({
            actor: adminId,
            action: 'payment.admin_status_change',
            targetType: 'Payment',
            targetId: updatedPayment._id?.toString(),
            metadata: {
                transactionId,
                from: existingPayment.status,
                to: paymentStatus,
                reason: reason.trim(),
            },
        });

        if (
            (paymentStatus === Status.Failed || paymentStatus === Status.Cancel) &&
            updatedPayment.enrollmentRef
        ) {
            notify = await failEnrollment(
                updatedPayment,
                session,
                'Payment ' + paymentStatus
            );
        }

        await session.commitTransaction();
        session.endSession();

        await flushPaymentNotify(notify);

        return {
            payment: updatedPayment,
            enrollment: updatedPayment.enrollmentRef
                ? await EnrollmentModel.findById(updatedPayment.enrollmentRef).lean()
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
    enrollmentRef: mongoose.Types.ObjectId;
    transactionId: string;
    amount: number;
    currency: string;
    status: string;
    method: string;
    gatewayResponse?: unknown;
}) => {
    const enrollment = await EnrollmentModel.findById(paymentData.enrollmentRef).lean();
    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    const payment = await PaymentModel.findOneAndUpdate(
        { enrollmentRef: paymentData.enrollmentRef },
        {
            userId: enrollment.userId,
            batchId: enrollment.batchId,
            enrollmentRef: paymentData.enrollmentRef,
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
    const payment = await PaymentModel.findOne({
        $or: [
            { transactionId },
            { 'gatewayResponse.supersededTranIds': transactionId },
        ],
    }).lean().populate({
        path: 'batchId',
        populate: {
            path: 'courseId',
            select: 'slug',
        },
    });

    if (!payment) {
        // Never throw on a browser-facing callback — redirect to not_found so
        // the frontend renders a sensible message instead of raw JSON.
        return {
            redirectUrl: `/payment?status=not_found&t=${encodeURIComponent(transactionId)}`,
            payment: null,
        };
    }

    const rawCourse = (payment.batchId as any)?.courseId;
    const courseSlug =
        (typeof rawCourse === 'object' ? rawCourse?.slug : undefined) ||
        (typeof rawCourse === 'string' ? rawCourse : '');
    const courseQuery = courseSlug ? `&course=${encodeURIComponent(courseSlug)}` : '';
    const amountQuery = typeof payment.amount === 'number' && payment.amount > 0 ? `&amount=${payment.amount}` : '';
    const currencyQuery = payment.currency ? `&currency=${encodeURIComponent(payment.currency)}` : '';
    const transactionQuery = `&t=${encodeURIComponent(transactionId)}${courseQuery}${amountQuery}${currencyQuery}`;

    let redirectUrl: string;
    const now = new Date();
    switch (payment.status) {
        case Status.Success:
            redirectUrl = `/payment?status=success${transactionQuery}`;
            break;
        case Status.Pending:
            // Computed expiry on read: if the session window lapsed, treat as
            // expired without writing (writes are the cron job's job).
            if (payment.expiresAt && payment.expiresAt < now) {
                redirectUrl = `/payment?status=expired${transactionQuery}`;
            } else {
                redirectUrl = `/payment?status=pending${transactionQuery}`;
            }
            break;
        case Status.Failed:
            redirectUrl = `/payment?status=failed${transactionQuery}`;
            break;
        case Status.Cancel:
            redirectUrl = `/payment?status=cancelled${transactionQuery}`;
            break;
        case Status.Expired:
            redirectUrl = `/payment?status=expired${transactionQuery}`;
            break;
        case Status.Review:
            redirectUrl = `/payment?status=review${transactionQuery}`;
            break;
        case Status.Superseded:
            redirectUrl = `/payment?status=superseded${transactionQuery}`;
            break;
        default:
            redirectUrl = `/payment?status=failed${transactionQuery}`;
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
        timeout: 10000,
        params: {
            val_id: valId,
            store_id: env.SSL_STORE_ID,
            store_passwd: env.SSL_STORE_PASSWORD,
            format: 'json',
        },
    });

    return data;
};

// ─── GATEWAY TRANSACTION LOOKUP (RECONCILIATION) ───

/**
 * Ask SSLCommerz for the authoritative state of a gateway transaction.
 *
 * Used by the reconciliation job to settle payments whose browser redirect and
 * IPN never reached us (tab closed, network drop, webhook outage).
 */
export const querySSLCommerzTransaction = async (
    transactionId: string
): Promise<Record<string, any> | null> => {
    return paymentGatewayAdapter.queryTransaction(transactionId);
};

// ─── FINALIZE SSLCOMMERZ PAYMENT ───

const finalizeSSLCommerzPayment = async (transactionId: string, valId: string) => {
    // Resolve the row WITHOUT a transaction first. If tran_id was superseded
    // by a newer initiation (double-click / retry / second tab), the paid
    // tran no longer sits on the row — rescue it via the recorded history
    // instead of hard-failing a payment the user actually completed.
    let payment = await PaymentModel.findOne({ transactionId });
    if (!payment) {
        payment = await PaymentModel.findOne({ 'gatewayResponse.supersededTranIds': transactionId });
        if (!payment) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
        }
        logger.warn(
            {
                event: 'payment.orphan_rescued',
                paid_tran_id: transactionId,
                current_tran_id: payment.transactionId,
                enrollmentId: payment.enrollmentId,
            },
            'Finalizing superseded gateway transaction against current payment row'
        );
    }

    if (payment.status === Status.Success) {
        return payment;
    }

    // Gateway validation is network I/O — it must never run inside the DB
    // transaction (60s txn lifetime limit + user-facing latency).
    const validation = await validateSSLCommerzPayment(valId);

    const session = await mongoose.startSession();
    let notify: PaymentNotifyIntent | null = null;

    try {
        await session.startTransaction();

        const locked = await PaymentModel.findById(payment._id).session(session);
        if (!locked) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
        }

        if (locked.status === Status.Success) {
            await session.commitTransaction();
            return locked;
        }

        // Non-terminal statuses that can move to Success on verified payment:
        // Pending, Cancel, Failed, Expired. Success/Refunded/Superseded are
        // terminal and are handled above (Success returns early; Refunded/
        // Superseded fall through to the validation checks below but will not
        // reach this point because they are terminal — however we guard here too).
        const terminalStatuses = [Status.Success, Status.Refunded, Status.Superseded];
        if (terminalStatuses.includes(locked.status)) {
            await session.commitTransaction();
            return locked;
        }

        if (validation.status !== 'VALID' && validation.status !== 'VALIDATED') {
            logger.warn(
                {
                    event: 'payment.validation_failed',
                    tran_id: locked.transactionId,
                    val_id: valId,
                    gatewayStatus: validation.status,
                },
                'SSLCommerz validation API returned non-VALID status; marking payment failed'
            );
            locked.status = Status.Failed;
            locked.gatewayResponse = {
                ...locked.gatewayResponse,
                val_id: valId,
                status: validation.status,
                processedAt: new Date(),
            };
            await locked.save({ session });
            await PaymentAttemptModel.updateMany(
                { transactionId: { $in: [locked.transactionId, validation.tran_id] } },
                {
                    $set: {
                        status: Status.Failed,
                        gatewayResponse: locked.gatewayResponse,
                    },
                },
                { session }
            );

            if (locked.enrollmentRef) {
                notify = await failEnrollment(locked, session, 'SSLCommerz validation failed');
            }

            await session.commitTransaction();
            await flushPaymentNotify(notify);
            return locked;
        }

        if (
            validation.tran_id !== transactionId ||
            Number(validation.amount) !== Number(locked.amount) ||
            validation.currency !== locked.currency
        ) {
            logger.error(
                {
                    event: 'payment.data_mismatch',
                    tran_id: locked.transactionId,
                    expected: { amount: locked.amount, currency: locked.currency },
                    received: { tran_id: validation.tran_id, amount: validation.amount, currency: validation.currency },
                },
                'Payment anti-tamper mismatch between stored record and gateway validation'
            );
            Sentry.captureMessage('Payment data mismatch', {
                level: 'warning',
                tags: { tran_id: locked.transactionId, event: 'payment.data_mismatch' },
                extra: {
                    expected: { amount: locked.amount, currency: locked.currency },
                    received: { tran_id: validation.tran_id, amount: validation.amount, currency: validation.currency },
                },
            });
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment data mismatch detected');
        }

        locked.status = Status.Success;
        locked.verifiedAt = new Date();
        locked.gatewayResponse = {
            ...locked.gatewayResponse,
            // Keep the actually-paid tran for audit when it differs (rescue).
            ...(validation.tran_id !== locked.transactionId
                ? { paidTranId: validation.tran_id }
                : {}),
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
        await locked.save({ session });

        // Shared settlement: assign enrollmentId + activate enrollment + status
        // history in ONE transaction via payment.enrollmentRef (ObjectId link).
        const settlementResult = await settlePaymentSuccess({
            payment: locked,
            session,
            context: 'SSLCommerz payment finalize',
            actorType: 'gateway',
        });
        notify = settlementResult.notify;

        await session.commitTransaction();
        await flushPaymentNotify(notify);
        return locked;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

// ─── CANCEL / FAIL HANDLERS ───

/**
 * Handle a gateway cancel (buyer clicked Cancel on SSLCommerz page).
 * Conditional update: only Pending → Cancel, never overwrites Success/Refunded.
 * Enrollment stays PaymentPending (reusable) — no enrollmentId was ever assigned.
 */
const handleCancelPayment = async (transactionId: string) => {
    const updated = await PaymentModel.findOneAndUpdate(
        { transactionId, status: Status.Pending },
        {
            $set: {
                status: Status.Cancel,
                cancelledAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { new: true }
    );

    if (!updated) {
        // Already terminal or not found — idempotent no-op.
        return null;
    }

    return updated;
};

/**
 * Handle a gateway fail (SSLCommerz reported failure).
 * Conditional update: only Pending → Failed, never overwrites Success/Refunded.
 */
const handleFailPayment = async (transactionId: string) => {
    const updated = await PaymentModel.findOneAndUpdate(
        { transactionId, status: Status.Pending },
        {
            $set: {
                status: Status.Failed,
                failedAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { new: true }
    );

    if (!updated) {
        return null;
    }

    return updated;
};

/**
 * Mark a stale Pending payment as Expired (called by the maintenance job only,
 * after reconciliation has queried the gateway). Read-only path computes
 * effective status without writing.
 */
const markPaymentExpired = async (transactionId: string) => {
    const updated = await PaymentModel.findOneAndUpdate(
        { transactionId, status: Status.Pending },
        {
            $set: {
                status: Status.Expired,
                failedAt: new Date(),
                updatedAt: new Date(),
            },
        },
        { new: true }
    );

    return updated ?? null;
};

// ─── GET MY PAYMENTS ───

const getMyPayments = async (userId: string) => {
    const payments = await PaymentModel.find({
        userId,
        status: { $nin: [Status.Failed, Status.Cancel, Status.Expired] },
    })
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

// ─── GATEWAY ATTEMPT BOOKKEEPING ───

/**
 * Record a gateway attempt on the enrollment's single payment row.
 *
 * One enrollment owns exactly one open payment, and `finalizeSSLCommerzPayment`
 * rescues payments completed on a superseded gateway session
 * (`gatewayResponse.supersededTranIds`). Retries therefore must not destroy
 * the row's audit trail (manual submission history, prior val_id/card data) —
 * but they also must not mix a whole-document `$set` with a dotted `$addToSet`:
 * MongoDB rejects overlapping paths ("Updating the path 'gatewayResponse'
 * would create a conflict at 'gatewayResponse'"), which is exactly the generic
 * 500 users hit on their second enrollment attempt.
 */
export const recordGatewayPaymentAttempt = async (params: {
    userId: string;
    batch: { _id: unknown; price?: number; currency?: string };
    enrollmentId: string;
    enrollmentRef: mongoose.Types.ObjectId;
    transactionId: string;
    valId?: string;
}) => {
    const { userId, batch, enrollmentId: _enrollmentId, enrollmentRef, transactionId, valId } = params;

    // Payment expires after the configured session window (default 30 minutes).
    const expiryMinutes = Number(env.PAYMENT_SESSION_EXPIRY_MINUTES) || 30;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Look up previous attempt by enrollmentRef (Enrollment ObjectId)
    const previousAttempt = await PaymentAttemptModel.findOne({ enrollmentRef })
        .select('transactionId gatewayResponse')
        .lean();

    // A legacy row can hold `gatewayResponse: null`; a dotted `$set` into null
    // throws PathNotViable. Normalise it to an object first.
    if (previousAttempt && previousAttempt.gatewayResponse === null) {
        await PaymentAttemptModel.updateOne(
            { _id: previousAttempt._id },
            { $set: { gatewayResponse: {} } }
        );
    }

    // Older enrollments may have a Payment row without a corresponding
    // PaymentAttempt row. Keep those retries recoverable as well — look it up
    // by enrollmentRef (the ObjectId link), not the MA- string.
    const previousPayment = previousAttempt
        ? null
        : await PaymentModel.findOne({ enrollmentRef })
              .select('transactionId gatewayResponse status')
              .lean();

    const previousTransactionId =
        previousAttempt?.transactionId || previousPayment?.transactionId;
    const shouldSupersede =
        typeof previousTransactionId === 'string' &&
        previousTransactionId.length > 0 &&
        previousTransactionId !== transactionId;

    // Supersede the previous attempt so we always know which attempt is current.
    if (shouldSupersede) {
        await PaymentAttemptModel.updateOne(
            { transactionId: previousTransactionId },
            {
                $set: {
                    status: Status.Superseded,
                    'gatewayResponse.supersededBy': transactionId,
                    'gatewayResponse.supersededAt': new Date(),
                },
            },
        );
    }

    const update: Record<string, unknown> = {
        $set: {
            userId,
            batchId: batch._id,
            enrollmentRef,
            transactionId,
            amount: batch.price,
            currency: batch.currency || 'BDT',
            status: Status.Pending,
            method: 'SSLCommerz',
            expiresAt,
            'gatewayResponse.retriedAt': new Date(),
        },
        $unset: {
            verifiedAt: '',
            verifiedBy: '',
            enrollmentId: '',
        },
    };

    await PaymentAttemptModel.findOneAndUpdate(
        { transactionId },
        {
            $setOnInsert: {
                userId,
                batchId: batch._id,
                enrollmentRef,
                transactionId,
                amount: Number(batch.price),
                currency: batch.currency || 'BDT',
                status: Status.Pending,
                method: 'SSLCommerz',
                ...(valId ? { 'gatewayResponse.valId': valId } : {}),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (shouldSupersede) {
        update.$addToSet = {
            'gatewayResponse.supersededTranIds': previousTransactionId,
        };
    }

    let paymentDoc;
    try {
        paymentDoc = await PaymentModel.findOneAndUpdate({ enrollmentRef }, update, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        });
    } catch (error: any) {
        // Only retry on a duplicate-key error that is specifically about the
        // enrollmentRef live-attempt index. Any other E11000 (e.g. enrollmentId
        // collision) is a real data problem and must not be silently swallowed.
        if (error?.code === 11000 && error.keyPattern && error.keyPattern.enrollmentRef === 1) {
            // The row exists from a concurrent initiation — apply the same
            // update once more (no upsert needed since the row is confirmed).
            paymentDoc = await PaymentModel.findOneAndUpdate({ enrollmentRef }, update, { new: true });
        } else {
            throw error;
        }
    }

    // Verify the write actually landed and carries the expected tran_id before
    // the gateway is ever told about it. If we can't confirm the row, abort
    // with a 500 rather than sending the learner to a gateway session that has
    // no local record (which makes cancel/fail/success callbacks 404).
    if (!paymentDoc || paymentDoc.transactionId !== transactionId) {
        logger.error(
            {
                event: 'payment.record_write_unconfirmed',
                enrollmentRef: enrollmentRef?.toString(),
                transactionId,
                expected: transactionId,
                got: paymentDoc?.transactionId,
            },
            'recordGatewayPaymentAttempt: persisted row does not match requested tran_id'
        );
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            'Payment record could not be saved. Please try again.'
        );
    }

    return paymentDoc;
};

// ─── INITIATE SSLCOMMERZ PAYMENT ───

const initiateSSLCommerzPayment = async (
    enrollmentRef: mongoose.Types.ObjectId,
    userId: string
) => {
    const enrollment = await EnrollmentModel.findById(enrollmentRef)
        .lean()
        .populate('batchId')
        .populate('userId');

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    if (
        enrollment.status !== EnrollmentStatus.PaymentPending &&
        enrollment.status !== EnrollmentStatus.PaymentFailed
    ) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Enrollment is not pending payment');
    }

    const currentPaymentFilters: Record<string, unknown> = { enrollmentRef };
    if (typeof enrollment.enrollmentId === 'string' && enrollment.enrollmentId.length > 0) {
        currentPaymentFilters.enrollmentId = enrollment.enrollmentId;
    }

    const currentPayment = await PaymentModel.findOne(currentPaymentFilters)
        .select('status method gatewayResponse')
        .lean();

    // One open payment per enrollment. Never let a gateway attempt overwrite a
    // manual payment that is queued for admin review (the learner would end up
    // paying twice), and never charge an enrollment that is already settled.
    if (currentPayment?.status === Status.Review) {
        throw new ApiError(
            StatusCodes.CONFLICT,
            'Your manual payment is already under verification. Please wait for approval before paying again.'
        );
    }

    if (currentPayment?.status === Status.Success) {
        throw new ApiError(
            StatusCodes.CONFLICT,
            'This enrollment has already been paid. Please check your enrollments.'
        );
    }

    // Treat legacy "pending" enrollments (pre-payment-pending rollout) as
    // payment-pending so retry does not 400 — they have no enrollmentId yet.
    const enrollableStatuses = [
        EnrollmentStatus.PaymentPending,
        EnrollmentStatus.PaymentFailed,
        EnrollmentStatus.Pending,
    ];
    if (!enrollableStatuses.includes(enrollment.status)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Enrollment is not pending payment');
    }

    const batch = enrollment.batchId;
    const user = enrollment.userId;
    const enrollmentIdString = typeof enrollment.enrollmentId === 'string' && enrollment.enrollmentId.length > 0
        ? enrollment.enrollmentId
        : undefined;

    const transactionId = generateTransactionId();
    const callbackKey = getStatusCallbackKey(transactionId);

    const paymentData = {
        store_id: config.SSL_STORE_ID,
        store_passwd: config.SSL_STORE_PASSWORD,
        total_amount: Number((batch as any).price).toFixed(2),
        currency: "BDT",
        tran_id: transactionId,
        success_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&k=${callbackKey}`,
        fail_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=failed&k=${callbackKey}`,
        cancel_url: `${config.SERVER_URL}/api/v1/payments/status?t=${transactionId}&status=cancel&k=${callbackKey}`,
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
        value_a: enrollmentIdString,
        value_b: userId,
        value_c: (batch as any)._id.toString(),
    };

    // Record the tran_id being replaced so finalize() can still rescue the
    // payment if the user completes the OLDER gateway session (double-click /
    // retry / second tab). Without this the paid tran_id vanishes from the DB
    // and the money is captured but never credited.
    await recordGatewayPaymentAttempt({
        userId,
        batch: batch as { _id: unknown; price?: number; currency?: string },
        enrollmentId: enrollmentIdString ?? '',
        enrollmentRef: enrollment._id,
        transactionId,
    });

    try {
        const response = await paymentGatewayAdapter.initiate(paymentData);
        if (response?.GatewayPageURL) {
            await PaymentModel.updateOne(
                { enrollmentRef: enrollment._id, transactionId },
                { $set: { 'gatewayResponse.gatewayPageURL': response.GatewayPageURL } }
            );
            await PaymentAttemptModel.updateOne(
                { transactionId },
                { $set: { 'gatewayResponse.gatewayPageURL': response.GatewayPageURL } }
            );
            return {
                paymentUrl: response.GatewayPageURL,
                enrollmentId: enrollmentIdString,
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

        // The learner never received a gateway URL, so this attempt can never
        // be completed. Record it as failed so Payment History stops showing a
        // forever-"pending" transaction; a later retry flips the row back.
        await PaymentModel.updateOne(
            { enrollmentRef: enrollment._id, transactionId },
            {
                $set: {
                    status: Status.Failed,
                    'gatewayResponse.initError': error?.message || 'Gateway init failed',
                    'gatewayResponse.failedAt': new Date(),
                },
            }
        ).catch((markError) => {
            logger.error(markError, 'Failed to mark uninitialised gateway attempt as failed');
        });
        await PaymentAttemptModel.updateOne(
            { transactionId },
            {
                $set: {
                    status: Status.Failed,
                    'gatewayResponse.initError': error?.message || 'Gateway init failed',
                    'gatewayResponse.failedAt': new Date(),
                },
            }
        ).catch((markError) => {
            logger.error(markError, 'Failed to mark payment attempt as failed');
        });

        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error?.message || 'Payment gateway initialization failed. Please contact support.'
        );
    }
};

// ─── VERIFY MANUAL PAYMENT ───

const verifyManualPayment = async (transactionId: string, approved: boolean, adminId: string) => {
    const session = await mongoose.startSession();
    // Assigned on every path below (approved / rejected); no initializer.
    let notify: PaymentNotifyIntent | null;

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

            payment.status = Status.Success;
            payment.verifiedAt = new Date();
            payment.verifiedBy = adminId as any;
            payment.gatewayResponse = {
                ...payment.gatewayResponse,
                verifiedAt: new Date(),
                verifiedBy: adminId,
            };
            await payment.save({ session });

            const result = await settlePaymentSuccess({
                payment,
                session,
                context: 'manual payment approval',
                actorType: 'admin',
                actorId: adminId,
                initializeModules: true,
            });
            notify = result.notify;

            logger.info(
                {
                    event: 'payment.manual_approved',
                    tran_id: transactionId,
                    enrollmentId: payment.enrollmentId,
                    adminId,
                    amount: payment.amount,
                    method: payment.method,
                    status: Status.Success,
                },
                'Manual payment approved by admin'
            );

            await recordAudit({
                actor: adminId,
                action: 'payment.manual_approve',
                targetType: 'Payment',
                targetId: payment._id?.toString(),
                metadata: { tran_id: transactionId, enrollmentId: payment.enrollmentId, amount: payment.amount, method: payment.method },
            });
        } else {
            payment.status = Status.Failed;
            payment.gatewayResponse = {
                ...payment.gatewayResponse,
                rejectedAt: new Date(),
                rejectedBy: adminId,
            };
            await payment.save({ session });

            notify = await failEnrollment(payment, session, 'Payment verification failed by admin');

            logger.info(
                {
                    event: 'payment.manual_rejected',
                    tran_id: transactionId,
                    adminId,
                    amount: payment.amount,
                    method: payment.method,
                    status: Status.Failed,
                },
                'Manual payment rejected by admin'
            );

            await recordAudit({
                actor: adminId,
                action: 'payment.manual_reject',
                targetType: 'Payment',
                targetId: payment._id?.toString(),
                metadata: { tran_id: transactionId, amount: payment.amount, method: payment.method },
            });
        }

        await session.commitTransaction();
        await flushPaymentNotify(notify);
        return payment;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

// ─── ADMIN RE-VERIFY WITH GATEWAY ───

/**
 * Admin-initiated re-verification of a payment against the gateway.
 *
 * Never trusts the admin's chosen status: queries SSLCommerz authoritatively
 * and applies whatever the gateway reports (subject to amount/currency/tran_id
 * comparison against the stored record). On verified Success, activates the
 * enrollment through the same guarded path as webhook finalization. On gateway
 * failure, marks the payment Failed. On transport failure, throws 503 and
 * leaves state untouched for retry.
 *
 * Every outcome is compare-and-set on the current payment status, transactional,
 * with status history, audit log, and Sentry alert.
 */
const reVerifyPaymentWithGateway = async (
    transactionId: string,
    adminId: string,
    reason: string,
    queryGateway: any = querySSLCommerzTransaction
) => {
    if (!reason?.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Reason is required for gateway re-verification');
    }

    const payment = await PaymentModel.findOne({ transactionId });
    if (!payment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
    }

    // Already terminal — no state change
    if (payment.status === Status.Success || payment.status === Status.Refunded) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Payment is already ${payment.status}; cannot re-verify`
        );
    }

    const gatewayResult = await queryGateway(transactionId);
    if (!gatewayResult) {
        Sentry.captureMessage('Gateway re-verify transport failure', {
            level: 'warning',
            tags: { transactionId, adminId, reason: reason.trim() },
        });
        throw new ApiError(
            StatusCodes.SERVICE_UNAVAILABLE,
            'Gateway unreachable — payment state unchanged, retry later'
        );
    }

    const gatewayTranId = String(gatewayResult.tran_id || transactionId);
    const gatewayStatus = String(gatewayResult.status || '').toUpperCase();
    const gatewayAmount = Number(gatewayResult.amount);
    const gatewayCurrency = String(gatewayResult.currency || '');

    // Anti-tamper: gateway data must match stored record
    if (
        gatewayTranId !== transactionId ||
        gatewayAmount !== Number(payment.amount) ||
        gatewayCurrency !== payment.currency
    ) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Gateway data mismatch with stored payment record'
        );
    }

    const session = await mongoose.startSession();
    let notify: PaymentNotifyIntent | null = null;

    try {
        await session.startTransaction();

        const locked = await PaymentModel.findOne({ transactionId }).session(session);
        if (!locked) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
        }

        // Compare-and-set: only act on non-terminal statuses
        if (locked.status === Status.Success || locked.status === Status.Refunded) {
            await session.commitTransaction();
            return { payment: locked, enrollment: null };
        }

        const isGatewaySuccess = gatewayStatus === 'VALID' || gatewayStatus === 'VALIDATED';
        const isGatewayFailure =
            gatewayStatus === 'FAILED' ||
            gatewayStatus === 'FAIL' ||
            gatewayStatus === 'FAILED_CARD' ||
            gatewayStatus === 'INVALID_TRANSACTION' ||
            gatewayStatus === 'CANCELLED' ||
            gatewayStatus === 'CANCELED' ||
            gatewayStatus === 'CANCEL';

        if (isGatewaySuccess) {
            locked.status = Status.Success;
            locked.gatewayResponse = {
                ...locked.gatewayResponse,
                val_id: gatewayResult.val_id || gatewayResult.valId || null,
                status: gatewayStatus,
                amount: gatewayAmount,
                currency: gatewayCurrency,
                bank_tran_id: gatewayResult.bank_tran_id,
                tran_date: gatewayResult.tran_date,
                processedAt: new Date(),
                reVerifiedBy: adminId,
                reVerifiedAt: new Date(),
                reVerifyReason: reason.trim(),
            };
            await locked.save({ session });

            const result = await settlePaymentSuccess({
                payment: locked,
                session,
                context: 'admin gateway re-verify',
                actorType: 'admin',
                actorId: adminId,
                initializeModules: false,
            });
            notify = result.notify;

            logger.info(
                {
                    event: 'payment.reverify_success',
                    tran_id: transactionId,
                    enrollmentId: locked.enrollmentId,
                    adminId,
                    amount: locked.amount,
                    currency: locked.currency,
                },
                'Admin re-verify: gateway confirmed payment success'
            );
        } else if (isGatewayFailure) {
            locked.status = Status.Failed;
            locked.gatewayResponse = {
                ...locked.gatewayResponse,
                status: gatewayStatus,
                amount: gatewayAmount,
                currency: gatewayCurrency,
                processedAt: new Date(),
                reVerifiedBy: adminId,
                reVerifiedAt: new Date(),
                reVerifyReason: reason.trim(),
            };
            await locked.save({ session });

            if (locked.enrollmentId) {
                notify = await failEnrollment(locked, session, 'Gateway re-verify reported failure');
            }

            logger.warn(
                {
                    event: 'payment.reverify_failure',
                    tran_id: transactionId,
                    enrollmentId: locked.enrollmentId,
                    adminId,
                    gatewayStatus,
                },
                'Admin re-verify: gateway reported payment failure'
            );
        }
        // Gateway pending/review/other: leave payment state unchanged

        await session.commitTransaction();
        await flushPaymentNotify(notify);

        Sentry.captureMessage('Admin-initiated payment re-verify', {
            level: 'info',
            tags: { paymentStatus: locked.status, transactionId },
            extra: { adminId, reason: reason.trim(), gatewayStatus },
        });

        await recordAudit({
            actor: adminId,
            action: 'payment.admin_reverify',
            targetType: 'Payment',
            targetId: locked._id?.toString(),
            metadata: {
                transactionId,
                from: payment.status,
                to: locked.status,
                gatewayStatus,
                reason: reason.trim(),
            },
        });

        return {
            payment: locked,
            enrollment: locked.enrollmentRef
                ? await EnrollmentModel.findById(locked.enrollmentRef).lean()
                : null,
        };
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
    const a = Buffer.from(params.verify_sign);
    const b = Buffer.from(expectedSign);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
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
        userId,
        $or: [
            { transactionId },
            { 'gatewayResponse.supersededTranIds': transactionId },
        ],
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
        // Exposed so the client can report the verified purchase value to
        // analytics instead of trusting tamperable URL params. Scoped to the
        // caller's own payment (matched by userId above).
        amount: payment.amount,
        currency: payment.currency,
    };
};

export const PaymentService = {
    getPaymentHistory,
    getPaymentDetail,
    updatePaymentWithEnrollStatus,
    checkPaymentStatus,
    finalizeSSLCommerzPayment,
    handleCancelPayment,
    handleFailPayment,
    markPaymentExpired,
    updatePayment,
    getMyPayments,
    initiateSSLCommerzPayment,
    verifyManualPayment,
    reVerifyPaymentWithGateway,
    failEnrollment,
    verifyWebhookSignature,
    getStatusCallbackKey,
    mapSslGatewayStatus,
    verifyPaymentForCurrentUser,
    activateEnrollmentForPayment,
    settlePaymentSuccess,
};
