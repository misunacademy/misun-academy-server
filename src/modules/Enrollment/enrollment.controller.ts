import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { EnrollmentService } from './enrollment.service.js';
import ApiError from '../../errors/ApiError.js';
import { PaymentService } from '../Payment/payment.service.js';
import { EnrollmentModel } from './enrollment.model.js';
/**
 * Initiate enrollment for a batch
 * Creates pending enrollment and returns payment URL
 */
const initiateEnrollment = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { batchId } = req.body;

    const result = await EnrollmentService.initiateEnrollment(id, batchId);

    const paymentResult = await PaymentService.initiateSSLCommerzPayment(
        result.enrollment.enrollmentId as string,
        id
    );

    sendResponse(res, {
        statusCode: result.isExisting ? StatusCodes.OK : StatusCodes.CREATED,
        success: true,
        message: result.isExisting
            ? 'Existing enrollment found. Proceed to payment.'
            : 'Enrollment initiated successfully. Proceed to payment.',
        data: {
            enrollmentId: result.enrollment.enrollmentId,
            batch: {
                title: (result.batch as any).title,
                price: (result.batch as any).price,
                currency: (result.batch as any).currency,
            },
            paymentUrl: paymentResult.paymentUrl,
            transactionId: paymentResult.transactionId,
        },
    });
});

/**
 * Get current user's enrollments
 */
const getMyEnrollments = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { status } = req.query;

    const enrollments = await EnrollmentService.getUserEnrollments(
        id,
        status as any
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Enrollments retrieved successfully',
        data: enrollments,
    });
});

/**
 * Get enrollment details
 */
const getEnrollmentDetails = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { enrollmentId } = req.params as { enrollmentId: string };

    const enrollment = await EnrollmentService.getEnrollmentDetails(enrollmentId, id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Enrollment details retrieved successfully',
        data: enrollment,
    });
});

/**
 * Admin: Get special access enrollments
 */
const getSpecialAccessEnrollments = catchAsync(async (req: Request, res: Response) => {
    const { page, limit, search } = req.query as {
        page?: string;
        limit?: string;
        search?: string;
    };

    const result = await EnrollmentService.getSpecialAccessEnrollments({
        page,
        limit,
        search,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Special access enrollments retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

/**
 * Admin: Get all enrollments with filters
 */
const getAllEnrollments = catchAsync(async (req: Request, res: Response) => {
    const { batchId, courseId, status, page = 1, limit = 10, search } = req.query;

    const result = await EnrollmentService.getAllEnrollments({
        batchId: batchId as string,
        courseId: courseId as string,
        status: status as string,
        page: page as string,
        limit: limit as string,
        search: search as string,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Enrollments retrieved successfully',
        meta: result.meta,
        data: result.data,
    });
});

/**
 * Admin: Update enrollment status
 */
const updateEnrollmentStatus = catchAsync(async (req: Request, res: Response) => {
    const { enrollmentId } = req.params;
    const { status, reason } = req.body;

    const enrollment = await EnrollmentModel.findByIdAndUpdate(
        enrollmentId,
        { status, $set: { statusChangeReason: reason } },
        { new: true }
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Enrollment status updated successfully',
        data: enrollment,
    });
});

/**
 * Admin: Grant course access by student email
 */
const grantAccessByEmail = catchAsync(async (req: Request, res: Response) => {
    const { email, courseId, batchId } = req.body as {
        email?: string;
        courseId?: string;
        batchId?: string;
    };

    if (!email || !courseId || !batchId) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Email, courseId, and batchId are required'
        );
    }

    const result = await EnrollmentService.grantAccessByEmail(email, courseId, batchId);
    const batch = result.batch as any;
    const course = (batch?.courseId as any) || {};

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: result.wasActive
            ? 'Student already has access to this batch'
            : 'Access granted successfully',
        data: {
            enrollmentId: result.enrollment.enrollmentId,
            status: result.enrollment.status,
            accessType: (result.enrollment as any).accessType,
            user: {
                id: result.user._id,
                name: result.user.name,
                email: result.user.email,
                studentId: result.user.studentId,
            },
            course: {
                id: course?._id?.toString() || courseId,
                title: course?.title,
            },
            batch: {
                id: batch?._id?.toString() || batchId,
                title: batch?.title,
            },
        },
    });
});

/**
 * Enroll with manual payment (PhonePay)
 * Creates enrollment awaiting admin verification
 */
const enrollWithManualPayment = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { batchId, paymentData } = req.body;

    if (!paymentData?.senderNumber || !paymentData?.transactionId) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Payment details (senderNumber and transactionId) are required'
        );
    }

    const result = await EnrollmentService.enrollWithManualPayment(
        id,
        batchId,
        paymentData
    );

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: result.message,
        data: {
            enrollmentId: result.enrollment._id,
            status: result.enrollment.status,
            batch: {
                title: result.batch.title,
                price: result.batch.price,
            },
        },
    });
});

export const EnrollmentController = {
    initiateEnrollment,
    enrollWithManualPayment,
    getMyEnrollments,
    getEnrollmentDetails,
    getSpecialAccessEnrollments,
    getAllEnrollments,
    updateEnrollmentStatus,
    grantAccessByEmail,
};
