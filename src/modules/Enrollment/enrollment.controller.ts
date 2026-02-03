import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { EnrollmentService } from './enrollment.service';
import ApiError from '../../errors/ApiError';
import mongoose from 'mongoose';
import { sendWaitingPaymentVerificationEmail } from '../../services/emailService';
import { UserModel } from '../User/user.model';

/**
 * Initiate enrollment for a batch
 * Creates pending enrollment and returns payment URL
 */
const initiateEnrollment = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { batchId } = req.body;

    const result = await EnrollmentService.initiateEnrollment(id, batchId);

    // If existing pending enrollment found, return it
    if (result.isExisting) {
        // Try to get existing payment URL
        const PaymentService = require('../Payment/payment.service').PaymentService;
        
        const paymentResult = await PaymentService.initiateSSLCommerzPayment(
            result.enrollment.enrollmentId,
            id
        );

        return sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Existing enrollment found. Proceed to payment.',
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
    }

    // Generate enrollment ID for SSLCommerz payments
    const enrollmentId = await EnrollmentService.generateEnrollmentId();
    
    // Update enrollment with ID
    result.enrollment.enrollmentId = enrollmentId;
    await result.enrollment.save();

    // Initiate SSLCommerz payment
    const PaymentService = require('../Payment/payment.service').PaymentService;
    const paymentResult = await PaymentService.initiateSSLCommerzPayment(
        enrollmentId,
        id
    );

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Enrollment initiated successfully. Proceed to payment.',
        data: {
            enrollmentId,
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
 * Admin: Get all enrollments with filters
 */
const getAllEnrollments = catchAsync(async (req: Request, res: Response) => {
    const { batchId, status, page = 1, limit = 10, search } = req.query;

    console.log('Search params:', { batchId, status, page, limit, search });

    const EnrollmentModel = require('./enrollment.model').EnrollmentModel;
    
    // Build aggregation pipeline
    const pipeline: any[] = [];

    // Match stage for basic filters
    const matchStage: any = {};
    if (batchId) matchStage.batchId = new mongoose.Types.ObjectId(batchId as string);
    if (status) matchStage.status = status;
    
    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
    }

    // Lookup stages to populate relations
    pipeline.push(
        {
            $lookup: {
                from: 'users',
                localField: 'id',
                foreignField: '_id',
                as: 'id',
            },
        },
        { $unwind: { path: '$id', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'profiles',
                localField: 'id._id',
                foreignField: 'user',
                as: 'userProfile',
            },
        },
        { $unwind: { path: '$userProfile', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'batches',
                localField: 'batchId',
                foreignField: '_id',
                as: 'batchId',
            },
        },
        { $unwind: { path: '$batchId', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'courses',
                localField: 'batchId.courseId',
                foreignField: '_id',
                as: 'course',
            },
        },
        { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } }
    );

    // Search filter across multiple fields
    if (search && typeof search === 'string' && search.trim() !== '') {
        // Escape special regex characters
        const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = { $regex: escapedSearch, $options: 'i' };
        pipeline.push({
            $match: {
                $or: [
                    { enrollmentId: searchRegex },
                    { 'id.name': searchRegex },
                    { 'id.email': searchRegex },
                    { 'id.phone': searchRegex },
                ],
            },
        });
        console.log('Applied search filter:', search, 'Escaped:', escapedSearch);
    }

    // Sort by creation date
    pipeline.push({ $sort: { createdAt: -1 } });

    console.log('Aggregation pipeline:', JSON.stringify(pipeline, null, 2));

    // Count total matching documents
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await EnrollmentModel.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;



    // Add pagination
    pipeline.push({ $skip: (Number(page) - 1) * Number(limit) });
    pipeline.push({ $limit: Number(limit) });

    // Execute aggregation
    const enrollments = await EnrollmentModel.aggregate(pipeline);

 
    // Transform data to match frontend expectations
    const transformedData = enrollments.map((enrollment: any) => ({
        _id: enrollment._id,
        studentId: enrollment.enrollmentId,
        student: enrollment.id ? {
            _id: enrollment.id._id,
            name: enrollment.id.name,
            email: enrollment.id.email,
            phone: enrollment.id.phone,
            address: enrollment.userProfile?.address || null,
        } : null,
        batch: enrollment.batchId ? {
            _id: enrollment.batchId._id,
            title: enrollment.batchId.title,
        } : null,
        course: enrollment.course ? {
            _id: enrollment.course._id,
            title: enrollment.course.title,
            slug: enrollment.course.slug,
        } : null,
        status: enrollment.status,
        createdAt: enrollment.createdAt,
    }));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Enrollments retrieved successfully',
        meta: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / Number(limit)),
        },
        data: transformedData,
    });
});

/**
 * Admin: Update enrollment status
 */
const updateEnrollmentStatus = catchAsync(async (req: Request, res: Response) => {
    const { enrollmentId } = req.params;
    const { status, reason } = req.body;

    const enrollment = await require('./enrollment.model').EnrollmentModel.findByIdAndUpdate(
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

    // Send payment verification pending email
    const user = await UserModel.findById(id);
    if (user) {
        sendWaitingPaymentVerificationEmail(
            user,
            result.batch.title,
            result.transactionId
        );
    }

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: result.message,
        data: {
            enrollmentId: result.enrollment._id, // Return enrollment _id since enrollmentId is assigned later
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
    getAllEnrollments,
    updateEnrollmentStatus,
};
