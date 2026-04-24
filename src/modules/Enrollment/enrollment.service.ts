import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { EnrollmentModel } from './enrollment.model.js';
import { EnrollmentCounterModel } from './enrollmentCounter.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { BatchStatus, EnrollmentStatus } from '../../types/common.js';
import { ModuleModel } from '../Module/module.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { ProgressStatus } from '../../types/common.js';
import { UserModel } from '../User/user.model.js';
import { Status } from '../../types/common.js';
import { PaymentModel } from '../Payment/payment.model.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { StudentIdCounterModel } from '../User/studentIdCounter.model.js';

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
const generateEnrollmentId = async (batch: string = '6', courseSlug: string = ''): Promise<string> => {
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
                const batchNumber = batchObj?.batchNumber?.toString() || '6';
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

        // Check if user already enrolled in active batch of same course
        const courseId = batch.courseId;

        const existingCourseEnrollment = await EnrollmentModel.findOne({
            userId,
            status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Pending] }
        })
        .populate({
            path: 'batchId',
            match: {
                courseId,
                status: { $in: [BatchStatus.Upcoming, BatchStatus.Running] }
            }
        })
        .session(session);

        if (existingCourseEnrollment && existingCourseEnrollment.batchId) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'You are already enrolled in a current batch of this course.'
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

/**
 * Initialize module progress for an enrollment
 * Idempotent - checks if already initialized
 */
const initializeModuleProgress = async (enrollmentId: string, batchId: string) => {
    // Check if already initialized
    const existingProgress = await ModuleProgressModel.findOne({ enrollmentId });
    if (existingProgress) {
        return; // Already initialized, skip
    }

    const batch = await BatchModel.findById(batchId).populate('courseId');

    if (!batch) return;

    // Get all modules for the course
    const modules = await ModuleModel.find({ courseId: batch.courseId }).sort({ orderIndex: 1 });

    if (modules.length === 0) return;

    // Create progress records for all modules
    // First module is unlocked by default, others are locked
    const progressRecords = modules.map((module, index) => ({
        enrollmentId,
        moduleId: module._id,
        status: index === 0 ? ProgressStatus.Unlocked : ProgressStatus.Locked,
        unlockedAt: index === 0 ? new Date() : undefined,
        completionPercentage: 0,
    }));

    await ModuleProgressModel.insertMany(progressRecords, { ordered: false });
};

/**
 * Get user's enrollments
 */
const getUserEnrollments = async (userId: string, status?: EnrollmentStatus) => {
    const query: any = { userId };
    if (status) query.status = status;

    const enrollments = await EnrollmentModel.find(query)
        .populate({
            path: 'batchId',
            populate: {
                path: 'courseId',
                select: 'title thumbnailImage category level isCertificateAvailable',
            },
        })
        .sort({ createdAt: -1 })
        .lean();

    // Add progress for each enrollment
    const enrollmentsWithProgress = await Promise.all(
        enrollments.map(async (enrollment) => {
            const moduleProgress = await ModuleProgressModel.find({ enrollmentId: enrollment._id });
            const modules = await ModuleModel.find({ courseId: (enrollment.batchId as any)?.courseId?._id ?? (enrollment.batchId as any)?.courseId });

            const totalModules = modules.length;
            const completedModules = moduleProgress.filter(
                (p) => p.status === ProgressStatus.Completed
            ).length;
            const overallProgress =
                totalModules > 0 ? Math.round((moduleProgress.reduce((sum, m) => sum + m.completionPercentage, 0) / totalModules)) : 0;

            return {
                ...enrollment,
                isCertificateAvailable:
                    (enrollment.batchId as any)?.courseId?.isCertificateAvailable !== undefined
                        ? (enrollment.batchId as any).courseId.isCertificateAvailable
                        : true,
                progress: {
                    totalModules,
                    completedModules,
                    overallProgress,
                },
            };
        })
    );

    return enrollmentsWithProgress;
};

/**
 * Get enrollment details
 */
const getEnrollmentDetails = async (enrollmentId: string, userId: string) => {
    const enrollment = await EnrollmentModel.findOne({
        _id: enrollmentId,
        userId,
    })
        .populate({
            path: 'batchId',
            populate: [
                {
                    path: 'courseId',
                },
                {
                    path: 'instructors',
                    populate: 'userId',
                },
            ],
        })
        .lean();

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    // Get progress statistics
    const moduleProgress = await ModuleProgressModel.find({ enrollmentId });
    const courseId = (enrollment.batchId as any)?.courseId?._id ?? (enrollment.batchId as any)?.courseId;
    const modules = courseId ? await ModuleModel.find({ courseId }).sort({ orderIndex: 1 }) : [];

    const totalModules = modules.length;
    const completedModules = moduleProgress.filter(
        (p) => p.status === ProgressStatus.Completed
    ).length;
    const overallProgress =
        totalModules > 0 ? Math.round((moduleProgress.reduce((sum, m) => sum + m.completionPercentage, 0) / totalModules)) : 0;

    return {
        ...enrollment,
        progress: {
            totalModules,
            completedModules,
            overallProgress,
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
    let existingEnrollment = await EnrollmentModel.findOne({
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

    const batch = await BatchModel.findById(batchId).populate('courseId');
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

        const batchNumber = batch.batchNumber?.toString() || '6';
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

const ensureStudentIdForUser = async (
    userId: string,
    session: mongoose.ClientSession
) => {
    await assignStudentIdIfMissing(userId, session);
};

export const EnrollmentService = {
    initiateEnrollment,
    // confirmEnrollment,
    enrollWithManualPayment,
    getUserEnrollments,
    getEnrollmentDetails,
    initializeModuleProgress,
    generateEnrollmentId, // Export this function
    ensureStudentIdForUser,
};
