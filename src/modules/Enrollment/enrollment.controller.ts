import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { EnrollmentService } from './enrollment.service.js';
import ApiError from '../../errors/ApiError.js';
import mongoose from 'mongoose';
import { EnrollmentStatus } from '../../types/common.js';
import { sendCourseWaitingPaymentVerificationEmail } from '../../services/courseEmailRouter.js';
import { UserModel } from '../User/user.model.js';
import { PaymentService } from '../Payment/payment.service.js';
import { EnrollmentModel } from './enrollment.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { ProgressStatus } from '../../types/common.js';
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
        // const PaymentService = require('../Payment/payment.service').PaymentService;

        const paymentResult = await PaymentService.initiateSSLCommerzPayment(
            result?.enrollment?.enrollmentId as string,
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
    const batchNumber = (result.batch as any).batchNumber?.toString() || '6';
    const courseSlug = (result.batch as any).courseId?.slug || '';
    const enrollmentId = await EnrollmentService.generateEnrollmentId(batchNumber, courseSlug);

    // Update enrollment with ID
    result.enrollment.enrollmentId = enrollmentId;
    await result.enrollment.save();

    // Initiate SSLCommerz payment
    // const PaymentService = require('../Payment/payment.service').PaymentService;
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
    const { batchId, courseId, status, page = 1, limit = 10, search } = req.query;

    console.log('Search params:', { batchId, courseId, status, page, limit, search });

    // const EnrollmentModel = require('./enrollment.model').EnrollmentModel;

    // Build aggregation pipeline
    const pipeline: any[] = [];

    // Match stage for basic filters
    const matchStage: any = {};

    // Only include enrollments that have a generated enrollmentId and are Active
    matchStage.enrollmentId = { $exists: true, $ne: null };
    const requestedStatus =
        typeof status === 'string' && Object.values(EnrollmentStatus).includes(status as EnrollmentStatus)
            ? (status as EnrollmentStatus)
            : EnrollmentStatus.Active;

    matchStage.status = requestedStatus;
    if (batchId) matchStage.batchId = new mongoose.Types.ObjectId(batchId as string);
    // Intentionally ignore incoming `status` query param since this endpoint should return only active enrollments

    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
    }

    // Lookup stages to populate relations
    pipeline.push(
        {
            $lookup: {
                from: 'users',
                // Enrollment documents reference users via `userId` in the schema
                localField: 'userId',
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

    if (courseId && typeof courseId === 'string' && mongoose.Types.ObjectId.isValid(courseId)) {
        pipeline.push({
            $match: {
                'course._id': new mongoose.Types.ObjectId(courseId),
            },
        });
    }

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

    const enrollmentIds = enrollments
        .map((enrollment: any) => enrollment._id)
        .filter(Boolean);

    const uniqueCourseIds = Array.from(
        new Set(
            enrollments
                .map((enrollment: any) => enrollment.course?._id?.toString())
                .filter(Boolean)
        )
    ).map((id) => new mongoose.Types.ObjectId(id));

    const [moduleProgressRecords, modulesPerCourse] = await Promise.all([
        enrollmentIds.length
            ? ModuleProgressModel.find(
                  { enrollmentId: { $in: enrollmentIds } },
                  { enrollmentId: 1, status: 1, completionPercentage: 1 }
              ).lean()
            : Promise.resolve([]),
        uniqueCourseIds.length
            ? ModuleModel.aggregate([
                  {
                      $match: {
                          courseId: { $in: uniqueCourseIds },
                      },
                  },
                  {
                      $group: {
                          _id: '$courseId',
                          totalModules: { $sum: 1 },
                      },
                  },
              ])
            : Promise.resolve([]),
    ]);

    const progressByEnrollment: Record<
        string,
        { completedModules: number; trackedModules: number; completionSum: number }
    > = {};

    for (const progress of moduleProgressRecords as any[]) {
        const enrollmentKey = progress.enrollmentId?.toString();
        if (!enrollmentKey) continue;

        if (!progressByEnrollment[enrollmentKey]) {
            progressByEnrollment[enrollmentKey] = {
                completedModules: 0,
                trackedModules: 0,
                completionSum: 0,
            };
        }

        progressByEnrollment[enrollmentKey].trackedModules += 1;
        progressByEnrollment[enrollmentKey].completionSum += progress.completionPercentage || 0;

        if (progress.status === ProgressStatus.Completed) {
            progressByEnrollment[enrollmentKey].completedModules += 1;
        }
    }

    const modulesPerCourseMap = new Map<string, number>(
        (modulesPerCourse as any[]).map((item) => [item._id?.toString(), item.totalModules || 0])
    );


    // Transform data to match frontend expectations
    const transformedData = enrollments.map((enrollment: any) => {
        const enrollmentKey = enrollment._id?.toString();
        const progressData = enrollmentKey
            ? progressByEnrollment[enrollmentKey]
            : undefined;
        const courseKey = enrollment.course?._id?.toString();
        const totalModules = courseKey
            ? modulesPerCourseMap.get(courseKey) ?? progressData?.trackedModules ?? 0
            : progressData?.trackedModules ?? 0;
        const completedModules = Math.min(progressData?.completedModules || 0, totalModules);
        let overallProgress = totalModules
            ? Math.round((progressData?.completionSum || 0) / totalModules)
            : 0;

        if (enrollment.status === EnrollmentStatus.Completed) {
            overallProgress = Math.max(overallProgress, 100);
        }

        return {
            _id: enrollment._id,
            studentId: enrollment.enrollmentId,
            student: enrollment.id
                ? {
                      _id: enrollment.id._id,
                      name: enrollment.id.name,
                      email: enrollment.id.email,
                      phone: enrollment.id.phone,
                      address: enrollment.userProfile?.address || null,
                  }
                : null,
            batch: enrollment.batchId
                ? {
                      _id: enrollment.batchId._id,
                      title: enrollment.batchId.title,
                  }
                : null,
            course: enrollment.course
                ? {
                      _id: enrollment.course._id,
                      title: enrollment.course.title,
                      slug: enrollment.course.slug,
                  }
                : null,
            status: enrollment.status,
            progress: {
                totalModules,
                completedModules,
                overallProgress,
            },
            createdAt: enrollment.createdAt,
        };
    });

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
        const courseData = (result.batch as any)?.courseId;
        const rawCourseName = typeof courseData === 'object'
            ? courseData?.title || ''
            : '';
        const courseSlug = typeof courseData === 'object'
            ? courseData?.slug || ''
            : '';
        const courseLabel = rawCourseName
            ? `${rawCourseName} - ${result.batch.title}`
            : result.batch.title;

        sendCourseWaitingPaymentVerificationEmail(
            { courseName: rawCourseName || result.batch.title, courseSlug },
            user,
            courseLabel,
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
