import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { EnrollmentModel } from './enrollment.model.js';
import { EnrollmentCounterModel } from './enrollmentCounter.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { BatchStatus, EnrollmentStatus, UserStatus } from '../../types/common.js';
import { ModuleModel } from '../Module/module.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { ProgressStatus } from '../../types/common.js';
import { UserModel } from '../User/user.model.js';
import { Status } from '../../types/common.js';
import { PaymentModel } from '../Payment/payment.model.js';
import { ProfileService } from '../Profile/profile.service.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { StudentIdCounterModel } from '../User/studentIdCounter.model.js';
import { NotificationService } from '../Notification/notification.service.js';
import { sendCourseWaitingPaymentVerificationEmail } from '../../services/courseEmailRouter.js';
import { logger } from '../../config/logger.js';
import {
    initializeModuleProgress,
    getUserEnrollments,
    getEnrollmentDetails,
} from './enrollmentProgress.service.js';

type MongoDuplicateKeyError = {
    code?: number;
    keyPattern?: Record<string, number>;
};

const isStudentIdDuplicateError = (error: unknown): error is MongoDuplicateKeyError => {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const mongoError = error as MongoDuplicateKeyError;
    return mongoError.code === 11000 && Boolean(mongoError.keyPattern?.studentId);
};

const syncStudentCounterToCurrentMax = async (
    year: string,
    session: mongoose.ClientSession
): Promise<void> => {
    const maxCountResult = await UserModel.aggregate<{ _id: null; maxCount: number }>([
        {
            $match: {
                studentId: {
                    $regex: `^SI-${year}-\\d+$`,
                },
            },
        },
        {
            $project: {
                countValue: {
                    $toInt: {
                        $arrayElemAt: [{ $split: ['$studentId', '-'] }, 2],
                    },
                },
            },
        },
        {
            $group: {
                _id: null,
                maxCount: { $max: '$countValue' },
            },
        },
    ]).session(session);

    const maxExistingCount = maxCountResult[0]?.maxCount ?? 0;

    await StudentIdCounterModel.updateOne(
        { _id: year },
        { $max: { count: maxExistingCount } },
        { upsert: true, session }
    );
};

const assignStudentIdIfMissing = async (
    userId: string,
    session: mongoose.ClientSession
): Promise<void> => {
    const user = await UserModel.findById(userId).session(session);

    if (!user || user.studentId) {
        return;
    }

    const year = new Date().getFullYear().toString();
    // Keep counter aligned before assigning a new ID.
    await syncStudentCounterToCurrentMax(year, session);

    const counter = await StudentIdCounterModel.findByIdAndUpdate(
        { _id: year },
        { $inc: { count: 1 } },
        {
            new: true,
            upsert: true,
            session,
        }
    );

    if (!counter) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            'Failed to generate student ID'
        );
    }

    const paddedCount = String(counter.count).padStart(4, '0');
    user.studentId = `SI-${year}-${paddedCount}`;

    try {
        await user.save({ session });
    } catch (error) {
        if (isStudentIdDuplicateError(error)) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Could not assign a unique student ID. Please try again.'
            );
        }

        throw error;
    }
};

/**
 * Generate unique enrollment ID
 */
// const generateEnrollmentId = async (batch: string = '6'): Promise<string> => {
//     const year = new Date().getFullYear();
//     const count = await EnrollmentModel.countDocuments();
//     const paddedCount = String(count + 1).padStart(5, '0');
//     return `MA-${batch}${year}${paddedCount}`;
// };
const generateEnrollmentId = async (batch: string = '', courseSlug: string = ''): Promise<string> => {
    const year = new Date().getFullYear();

    const isEnglishCourse = courseSlug.toLowerCase().includes('english');
    const prefix = isEnglishCourse ? 'EP' : 'MA';
    const counterId = `${prefix}-${batch}`;

    // Use findByIdAndUpdate for atomic increment per batch
    const counter = await EnrollmentCounterModel.findByIdAndUpdate(
        { _id: counterId }, // Counter per batch and course prefix
        { $inc: { count: 1 } },
        { new: true, upsert: true }
    );

    const paddedCount = String(counter.count).padStart(5, '0');
    return `${prefix}-${batch}${year}${paddedCount}`;
};
/**
 * Generate a unique transaction ID for payments
 * Format: TXN-{timestamp}-{random}
 */
const generateTransactionId = (): string => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TXN-${timestamp}-${random}`;
};

/**
 * Initiate enrollment for a batch
 * With idempotency - returns existing pending enrollment if found
 */
// const initiateEnrollment = async (userId: string, batchId: string) => {
//     // Check if user has pending enrollment for this batch (idempotency)
//     const existingPendingEnrollment = await EnrollmentModel.findOne({
//         userId,
//         batchId,
//         status: { $in: [EnrollmentStatus.Pending, EnrollmentStatus.PaymentPending] }
//     }).populate('batchId');

//     if (existingPendingEnrollment) {
//         // Return existing pending enrollment instead of creating duplicate
//         return {
//             enrollment: existingPendingEnrollment,
//             batch: existingPendingEnrollment.batchId,
//             isExisting: true,
//         };
//     }

//     // Check if batch exists and is accepting enrollments
//     const batch = await BatchModel.findById(batchId).populate('courseId');

//     if (!batch) {
//         throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
//     }

//     // Check batch status
//     if (batch.status !== BatchStatus.Upcoming && batch.status !== BatchStatus.Running) {
//         throw new ApiError(
//             StatusCodes.BAD_REQUEST,
//             'This batch is not accepting new enrollments'
//         );
//     }

//     // Check enrollment window
//     const now = new Date();
//     if (now > batch.enrollmentEndDate) {
//         throw new ApiError(StatusCodes.BAD_REQUEST, 'Enrollment period has ended for this batch');
//     }

//     // Check if user already enrolled in THIS batch
//     const existingEnrollment = await EnrollmentModel.findOne({
//         userId,
//         batchId,
//     });

//     if (existingEnrollment) {
//         throw new ApiError(
//             StatusCodes.CONFLICT,
//             'You are already enrolled in this batch'
//         );
//     }

//     // Check if user is enrolled in a CURRENT (running/upcoming) batch of the same course
//     // Only allow one active enrollment per course at a time
//     const courseId = batch.courseId;
//     const existingCourseEnrollment = await EnrollmentModel.findOne({
//         userId,
//         status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Pending] }
//     }).populate({
//         path: 'batchId',
//         match: {
//             courseId,
//             status: { $in: [BatchStatus.Upcoming, BatchStatus.Running] }
//         }
//     });

//     if (existingCourseEnrollment && existingCourseEnrollment.batchId) {
//         throw new ApiError(
//             StatusCodes.CONFLICT,
//             'You are already enrolled in a current batch of this course. You can only enroll in one batch at a time.'
//         );
//     }

//     // Create pending enrollment (without enrollmentId initially)
//     const enrollment = await EnrollmentModel.create({
//         userId,
//         batchId,
//         status: EnrollmentStatus.Pending,
//     });
//   // Assign unique Student ID if the user doesn't have one
//         const user = await UserModel.findById(enrollment.userId);
//         if (user && !user.studentId) {
//             const year = new Date().getFullYear().toString();
//             const counter = await StudentIdCounterModel.findByIdAndUpdate(
//                 { _id: year },
//                 { $inc: { count: 1 } },
//                 { new: true, upsert: true }
//             );
//             const paddedCount = String(counter.count).padStart(4, '0');
//             user.studentId = `MA-${year}-${paddedCount}`;
//             await user.save();
//         }
//     return {
//         enrollment,
//         batch,
//         isExisting: false,
//     };
// };

const initiateEnrollment = async (userId: string, batchId: string) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        // Check pending enrollment (idempotency)
        const existingPendingEnrollment = await EnrollmentModel.findOne({
            userId,
            batchId,
            status: {
                $in: [
                    EnrollmentStatus.Pending,
                    EnrollmentStatus.PaymentPending,
                    EnrollmentStatus.PaymentFailed,
                ]
            }
        })
        .populate('batchId')
        .session(session);

        if (existingPendingEnrollment) {
            // Ensure existing enrollment has an enrollmentId (required for SSLCommerz flow)
            if (!existingPendingEnrollment.enrollmentId) {
                const batchObj = existingPendingEnrollment.batchId as any;
                const batchNumber = batchObj?.title.split(' ')[1];
                const courseSlug = (batchObj?.courseId as any)?.slug || '';
                const generatedEnrollmentId = await generateEnrollmentId(batchNumber, courseSlug);
                existingPendingEnrollment.enrollmentId = generatedEnrollmentId;
                await existingPendingEnrollment.save({ session });
            }

            // Existing pending enrollments from older data may miss studentId.
            await assignStudentIdIfMissing(userId, session);

            await session.commitTransaction();

            return {
                enrollment: existingPendingEnrollment,
                batch: existingPendingEnrollment.batchId,
                isExisting: true,
            };
        }

        // Check batch
        const batch = await BatchModel.findById(batchId)
            .populate('courseId')
            .lean()
            .session(session);

        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
        }

        // Validate batch status
        if (
            batch.status !== BatchStatus.Upcoming &&
            batch.status !== BatchStatus.Running
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                'This batch is not accepting new enrollments'
            );
        }

        // Validate enrollment window
        const now = new Date();
        if (now > batch.enrollmentEndDate) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                'Enrollment period has ended for this batch'
            );
        }

        // Create enrollment
        let enrollment;

        try {

            const created = await EnrollmentModel.create(
                [{
                    userId,
                    batchId,
                    status: EnrollmentStatus.Pending
                }],
                { session }
            );

            enrollment = created[0];

        } catch (err: any) {

            if (err.code === 11000) {
                throw new ApiError(
                    StatusCodes.CONFLICT,
                    'You are already enrolled in this batch'
                );
            }

            throw err;
        }

        // Assign Student ID if not exists
        await assignStudentIdIfMissing(userId, session);

        await session.commitTransaction();

        // Generate enrollment ID and fire notification for new enrollments
        const batchNumber = batch.title?.split(' ')[1];
        const courseSlug = (batch.courseId as any)?.slug || '';
        enrollment.enrollmentId = await generateEnrollmentId(batchNumber, courseSlug);
        await enrollment.save();

        setImmediate(async () => {
            try {
                const user = await UserModel.findById(userId).lean();
                if (user) {
                    const courseTitle = (batch.courseId as any)?.title || batch.title;
                    await NotificationService.createNotificationForAdmins({
                        type: 'enrollment',
                        title: 'New Enrollment',
                        message: `${user.name} has enrolled in ${courseTitle} - ${batch.title}`,
                        link: '/dashboard/admin/student',
                    });
                }
            } catch (error) {
                logger.error(error, 'Failed to send enrollment notification');
            }
        });

        return {
            enrollment,
            batch,
            isExisting: false,
        };
    } catch (error) {

        if (session.inTransaction()) {
            await session.abortTransaction();
        }

        throw error;
    } finally {
        session.endSession();
    }
};
/**
 * Confirm enrollment after successful payment
 * Provides lifetime access - no expiry unless user is suspended
 * Idempotent - can be called multiple times safely (webhook + redirect)
 */
// const confirmEnrollment = async (enrollmentId: string, paymentId: string) => {
//     const enrollment = await EnrollmentModel.findOne({ enrollmentId });

//     if (!enrollment) {
//         throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
//     }

//     // Idempotency: If already active, just return it
//     if (enrollment.status === EnrollmentStatus.Active) {
//         return enrollment;
//     }

//     if (enrollment.status !== EnrollmentStatus.Pending && enrollment.status !== EnrollmentStatus.PaymentPending) {
//         throw new ApiError(StatusCodes.BAD_REQUEST, `Cannot confirm enrollment with status: ${enrollment.status}`);
//     }

//     // const mongoose = require('mongoose');
//     const session = await mongoose.startSession();

//     try {
//         await session.startTransaction();

//         // Update enrollment - LIFETIME ACCESS (no expiry date)
//         enrollment.status = EnrollmentStatus.Active;
//         enrollment.paymentId = paymentId as any;
//         enrollment.enrolledAt = new Date();

//         await enrollment.save({ session });

//         // Increment batch enrollment count (only if not already incremented)
//         const batch = await BatchModel.findById(enrollment.batchId);
//         if (batch) {
//             await BatchModel.findByIdAndUpdate(
//                 enrollment.batchId,
//                 { $inc: { currentEnrollment: 1 } },
//                 { session }
//             );
//         }

//         // Initialize module progress when batch starts
//         await initializeModuleProgress(enrollment._id.toString(), enrollment.batchId.toString());

//         // Assign unique Student ID if the user doesn't have one
//         const user = await UserModel.findById(enrollment.userId).session(session);
//         if (user && !user.studentId) {
//             const year = new Date().getFullYear().toString();
//             const counter = await StudentIdCounterModel.findByIdAndUpdate(
//                 { _id: year },
//                 { $inc: { count: 1 } },
//                 { new: true, upsert: true, session }
//             );
//             const paddedCount = String(counter.count).padStart(4, '0');
//             user.studentId = `MA-${year}-${paddedCount}`;
//             await user.save({ session });
//         }

//         await session.commitTransaction();

//         // AUTOMATIC PROFILE CREATION/UPDATE - Single source of truth
//         // This runs after enrollment confirmation regardless of payment method
//         try {
//             await ProfileService.createOrUpdateProfileAfterEnrollment(
//                 enrollment.userId.toString(),
//                 enrollment.enrollmentId!
//             );
//         } catch (profileError) {
//             // Log error but don't fail enrollment - profile can be synced later
//             console.error('Failed to update student profile after enrollment:', profileError);
//         }

//         // Send enrollment confirmation email (async, don't block)
//         setImmediate(async () => {
//             try {
//                 const user = await UserModel.findById(enrollment.userId);
//                 const batchData = await BatchModel.findById(enrollment.batchId).populate('courseId');
//                 if (user && batchData && batchData.courseId) {
//                     sendEnrollmentConfirmationEmail(
//                         user,
//                         (batchData.courseId as any).title || 'Unknown Course',
//                         enrollment.enrollmentId || 'N/A'
//                     );
//                 }
//             } catch (emailError) {
//                 console.error('Failed to send enrollment confirmation email:', emailError);
//             }
//         });

//         return enrollment;
//     } catch (error) {
//         await session.abortTransaction();
//         throw error;
//     } finally {
//         session.endSession();
//     }
// };



const getSpecialAccessEnrollments = async (params: {
    page?: number | string;
    limit?: number | string;
    search?: string;
}) => {
    const pageNumber = Number(params.page) || 1;
    const limitNumber = Number(params.limit) || 10;
    const skip = (pageNumber - 1) * limitNumber;
    const query: any = { accessType: 'special' };

    if (params.search) {
        const escaped = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escaped, 'i');
        const matchedUsers = await UserModel.find({
            $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }],
        })
            .select('_id')
            .lean();

        const userIds = matchedUsers.map((user) => user._id);

        if (userIds.length === 0) {
            return {
                data: [],
                meta: {
                    total: 0,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: 0,
                },
            };
        }

        query.userId = { $in: userIds };
    }

    const [data, total] = await Promise.all([
        EnrollmentModel.find(query)
            .populate({
                path: 'userId',
                select: 'name email status studentId',
            })
            .populate({
                path: 'batchId',
                select: 'title courseId',
                populate: { path: 'courseId', select: 'title' },
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNumber)
            .lean(),
        EnrollmentModel.countDocuments(query),
    ]);

    return {
        data,
        meta: {
            total,
            page: pageNumber,
            limit: limitNumber,
            totalPages: Math.ceil(total / limitNumber),
        },
    };
};



/**
 * Enroll student with manual payment
 * Creates enrollment in PaymentPending status awaiting admin verification
 */
const enrollWithManualPayment = async (
    userId: string,
    batchId: string,
    paymentData: { senderNumber: string; transactionId: string }
) => {
    // Check if user has any enrollment for this batch
    const existingEnrollment = await EnrollmentModel.findOne({
        userId,
        batchId,
        status: { $in: [EnrollmentStatus.Pending, EnrollmentStatus.PaymentPending, EnrollmentStatus.PaymentFailed, EnrollmentStatus.Active] }
    });

    if (existingEnrollment) {
        if (existingEnrollment.status === EnrollmentStatus.Active) {
            throw new ApiError(StatusCodes.CONFLICT, 'You are already enrolled in this batch');
        }

        // Allow reusing an existing pending/failed enrollment for manual payment
        existingEnrollment.status = EnrollmentStatus.PaymentPending;
        await existingEnrollment.save();
    }

    const batch = await BatchModel.findById(batchId).populate('courseId').lean();
    if (!batch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
    }

    if (batch.status !== BatchStatus.Upcoming && batch.status !== BatchStatus.Running) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'This batch is not accepting enrollments');
    }

    const now = new Date();
    if (now > batch.enrollmentEndDate) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Enrollment period is not active');
    }

    const courseSlug = (batch.courseId as any)?.slug || '';
    const isEnglishCourse = /english/i.test(courseSlug);
    const manualPaymentAmount =
        typeof (batch as any).manualPaymentPrice === 'number'
            ? (batch as any).manualPaymentPrice
            : isEnglishCourse
                ? 2289
                : 3661;

    const session = await mongoose.startSession();

    try {
        await session.startTransaction();

        let enrollment = existingEnrollment;

        const batchNumber = batch.title?.split(' ')[1];
        const courseSlug = (batch.courseId as any)?.slug || '';

        // Create or reuse enrollment with a robust enrollmentId assignment.
        if (!enrollment) {
            let attempt = 0;
            while (!enrollment) {
                const candidateEnrollmentId = await generateEnrollmentId(batchNumber, courseSlug);
                try {
                    const created = await EnrollmentModel.create([
                        {
                            userId,
                            batchId,
                            status: EnrollmentStatus.PaymentPending,
                            enrollmentId: candidateEnrollmentId,
                        },
                    ], { session });
                    enrollment = created[0];
                } catch (err: any) {
                    if (err.code === 11000 && err.keyPattern?.enrollmentId) {
                        attempt += 1;
                        if (attempt >= 5) {
                            throw new ApiError(
                                StatusCodes.INTERNAL_SERVER_ERROR,
                                'Failed to generate a unique enrollment ID. Please try again.'
                            );
                        }
                        continue;
                    }
                    throw err;
                }
            }
        } else {
            // Keep using existing enrollment, ensure ID exists.
            await EnrollmentModel.findByIdAndUpdate(
                enrollment._id,
                { status: EnrollmentStatus.PaymentPending },
                { session }
            );

            if (!enrollment.enrollmentId) {
                let attempt = 0;
                while (!enrollment.enrollmentId) {
                    const candidateEnrollmentId = await generateEnrollmentId(batchNumber, courseSlug);
                    try {
                        enrollment.enrollmentId = candidateEnrollmentId;
                        await enrollment.save({ session });
                    } catch (err: any) {
                        if (err.code === 11000 && err.keyPattern?.enrollmentId) {
                            attempt += 1;
                            if (attempt >= 5) {
                                throw new ApiError(
                                    StatusCodes.INTERNAL_SERVER_ERROR,
                                    'Failed to assign a unique enrollment ID. Please try again.'
                                );
                            }
                            continue;
                        }
                        throw err;
                    }
                }
            }
        }

        const paymentTransactionId = generateTransactionId();

        await PaymentModel.findOneAndUpdate(
            { enrollmentId: enrollment.enrollmentId },
            {
                userId,
                batchId,
                transactionId: paymentTransactionId,
                amount: manualPaymentAmount,
                currency: 'BDT',
                status: Status.Review,
                method: 'PhonePay',
                gatewayResponse: {
                    senderNumber: paymentData.senderNumber,
                    phonePeTransactionId: paymentData.transactionId,
                    submittedAt: new Date(),
                },
                enrollmentId: enrollment.enrollmentId,
            },
            {
                session,
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            }
        );

        await session.commitTransaction();

        setImmediate(async () => {
            try {
                const user = await UserModel.findById(userId).lean();
                if (user) {
                    const courseData = (batch.courseId as any);
                    const courseTitle = typeof courseData === 'object' ? (courseData?.title || '') : '';
                    await NotificationService.createNotificationForAdmins({
                        type: 'payment_pending',
                        title: 'Manual Payment Pending',
                        message: `${user.name} submitted a manual payment for ${courseTitle || batch.title}`,
                        link: '/dashboard/admin/payment',
                    });

                    const rawCourseName = courseTitle;
                    const courseSlug = typeof courseData === 'object' ? (courseData?.slug || '') : '';
                    const courseLabel = rawCourseName
                        ? `${rawCourseName} - ${batch.title}`
                        : batch.title;

                    sendCourseWaitingPaymentVerificationEmail(
                        { courseName: rawCourseName || batch.title, courseSlug },
                        user,
                        courseLabel,
                        paymentTransactionId
                    );
                }
            } catch (error) {
                logger.error(error, 'Failed to send manual payment notification');
            }
        });

        return {
            enrollment,
            batch,
            transactionId: paymentTransactionId,
            message: 'Payment submitted for verification. You will receive confirmation within 12-24 hours.',
        };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

const grantAccessByEmail = async (email: string, courseId: string, batchId: string) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Student email is required');
    }

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid course ID');
    }

    if (!mongoose.Types.ObjectId.isValid(batchId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid batch ID');
    }

    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const user = await UserModel.findOne({ email: normalizedEmail }).lean().session(session);

        if (!user) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'User not found for this email');
        }

        if (user.status !== UserStatus.Active) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'User is not active');
        }

        const batch = await BatchModel.findById(batchId).populate('courseId').lean().session(session);

        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
        }

        const batchCourseId =
            (batch.courseId as any)?._id?.toString() ??
            (batch.courseId as any)?.toString();

        if (batchCourseId && batchCourseId !== courseId) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                'Selected batch does not belong to the selected course'
            );
        }

        let enrollment = await EnrollmentModel.findOne({
            userId: user._id,
            batchId: batch._id,
        }).session(session);

        const isActiveOrCompleted = enrollment
            ? [EnrollmentStatus.Active, EnrollmentStatus.Completed].includes(enrollment.status)
            : false;

        if (enrollment && isActiveOrCompleted) {
            await assignStudentIdIfMissing(user._id.toString(), session);

            if (enrollment.enrollmentId) {
                await ProfileService.createOrUpdateProfileAfterEnrollment(
                    user._id.toString(),
                    enrollment.enrollmentId,
                    session
                );
            }

            await session.commitTransaction();

            return {
                enrollment,
                user,
                batch,
                wasActive: true,
            };
        }

        const wasActive = false;

        if (!enrollment) {
            const batchNumber = (batch as any).title?.split(' ')[1];
            const courseSlug = (batch.courseId as any)?.slug || '';
            const enrollmentId = await generateEnrollmentId(batchNumber, courseSlug);

            const created = await EnrollmentModel.create(
                [
                    {
                        userId: user._id,
                        batchId: batch._id,
                        status: EnrollmentStatus.Active,
                        accessType: 'special',
                        enrollmentId,
                        enrolledAt: new Date(),
                    },
                ],
                { session }
            );

            enrollment = created[0];
        } else {
            let shouldSave = false;

            if (enrollment.accessType !== 'special') {
                enrollment.accessType = 'special';
                shouldSave = true;
            }

            if (!enrollment.enrollmentId) {
                const batchNumber = (batch as any).title?.split(' ')[1];
                const courseSlug = (batch.courseId as any)?.slug || '';
                enrollment.enrollmentId = await generateEnrollmentId(batchNumber, courseSlug);
                shouldSave = true;
            }

            if (!wasActive) {
                enrollment.status = EnrollmentStatus.Active;
                enrollment.enrolledAt = new Date();
                shouldSave = true;
            }

            if (shouldSave) {
                await enrollment.save({ session });
            }
        }

        await assignStudentIdIfMissing(user._id.toString(), session);

        if (!wasActive) {
            await BatchModel.findByIdAndUpdate(
                batch._id,
                { $inc: { currentEnrollment: 1 } },
                { session }
            );
        }

        if (enrollment.enrollmentId) {
            await ProfileService.createOrUpdateProfileAfterEnrollment(
                user._id.toString(),
                enrollment.enrollmentId,
                session
            );
        }

        await session.commitTransaction();

        if (!wasActive) {
            await initializeModuleProgress(enrollment._id.toString());

            const course = (batch.courseId as any) || {};
            setImmediate(async () => {
                try {
                    await NotificationService.createNotification({
                        userId: user._id.toString(),
                        type: 'access_granted',
                        title: 'Course Access Granted',
                        message: `You have been granted access to ${course?.title || 'Course'} - ${batch?.title}`,
                        link: '/my-classes',
                    });
                } catch (error) {
                    logger.error(error, 'Failed to send access granted notification');
                }
            });
        }

        return {
            enrollment,
            user,
            batch,
            wasActive,
        };
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        session.endSession();
    }
};

const ensureStudentIdForUser = async (
    userId: string,
    session: mongoose.ClientSession
) => {
    await assignStudentIdIfMissing(userId, session);
};

const getAllEnrollments = async (params: {
    batchId?: string;
    courseId?: string;
    status?: string;
    page?: string | number;
    limit?: string | number;
    search?: string;
}) => {
    const { batchId, courseId, status: statusParam, page = 1, limit = 10, search } = params;
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const pipeline: any[] = [];

    const matchStage: any = {};
    matchStage.enrollmentId = { $exists: true, $ne: null };
    const requestedStatus =
        typeof statusParam === 'string' && Object.values(EnrollmentStatus).includes(statusParam as EnrollmentStatus)
            ? (statusParam as EnrollmentStatus)
            : EnrollmentStatus.Active;
    matchStage.status = requestedStatus;
    if (batchId) matchStage.batchId = new mongoose.Types.ObjectId(batchId as string);

    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
    }

    pipeline.push(
        {
            $lookup: {
                from: 'users',
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
            $match: { 'course._id': new mongoose.Types.ObjectId(courseId) },
        });
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
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
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await EnrollmentModel.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    pipeline.push({ $skip: (pageNumber - 1) * limitNumber });
    pipeline.push({ $limit: limitNumber });

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
                  { $match: { courseId: { $in: uniqueCourseIds } } },
                  { $group: { _id: '$courseId', totalModules: { $sum: 1 } } },
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

    const data = enrollments.map((enrollment: any) => {
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

    return {
        data,
        meta: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages: Math.ceil(total / limitNumber),
        },
    };
};

export const EnrollmentService = {
    initiateEnrollment,
    enrollWithManualPayment,
    grantAccessByEmail,
    getSpecialAccessEnrollments,
    getUserEnrollments,
    getEnrollmentDetails,
    getAllEnrollments,
    initializeModuleProgress,
    generateEnrollmentId,
    ensureStudentIdForUser,
};
