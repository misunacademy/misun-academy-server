import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { EnrollmentModel } from './enrollment.model.js';
import { EnrollmentStatusHistoryModel } from './enrollmentStatusHistory.model.js';
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
import { CourseBrand, deriveCourseBrand } from '../../utils/courseBrand.js';
import { recordAudit } from '../../models/auditLog.model.js';
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
 * Resolve the human batch number for enrollment IDs. Prefers the numeric
 * `batch.batchNumber` field; falls back to digits parsed from the title
 * (legacy "Batch 3" convention). Never yields "undefined" counter IDs.
 */
const parseBatchNumber = (batch: any): string => {
    const direct = Number(batch?.batchNumber);
    if (Number.isFinite(direct) && direct > 0) {
        return String(Math.floor(direct));
    }
    const fromTitle = String(batch?.title ?? '').match(/(\d+)/)?.[1];
    return fromTitle ?? '0';
};

/**
 * Generate unique enrollment ID
 */
const generateEnrollmentId = async (
    batch: string = '',
    brand: CourseBrand = CourseBrand.MA
): Promise<string> => {
    const year = new Date().getFullYear();

    const prefix = brand === CourseBrand.EP ? 'EP' : 'MA';
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
 * Shared enrollment entry point. Every path that creates an Enrollment
 * document (learner self-enroll, admin grant-access, manual payment) funnels
 * through here. Enforces the same invariants regardless of channel:
 *   - user must be Active (not suspended/banned/unverified)
 *   - batch must exist and be accepting enrollments (Upcoming/Running or evergreen)
 *   - enrollment window must be open unless evergreen
 *   - no Active/Completed/Suspended enrollment for the same user+batch
 * Writes the enrollment row inside a transaction, appends status history,
 * and increments currentEnrollment only when entering Active.
 */
const createEnrollment = async ({
    userId,
    batchId,
    source = 'self',
    accessType = 'standard',
    actor,
    externalSession,
}: {
    userId: string;
    batchId: string;
    source?: 'self' | 'admin' | 'manual-payment';
    accessType?: 'standard' | 'special';
    actor?: { id: string; role?: string };
    externalSession?: mongoose.ClientSession;
}) => {
    const shouldOwnTransaction = !externalSession;
    const session = externalSession ?? await mongoose.startSession();

    try {
        if (shouldOwnTransaction) {
            await session.startTransaction();
        }

        // 1. User must be Active
        const user = await UserModel.findById(userId).session(session).lean();
        if (!user || user.status !== UserStatus.Active) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                'You cannot enroll in this batch'
            );
        }

        // 2. Batch validation
        const batch = await BatchModel.findById(batchId)
            .populate('courseId')
            .session(session)
            .lean();

        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
        }

        const isEvergreen =
            (batch as any).isEvergreen === true ||
            (batch as any).deliveryMode === 'recorded';

        if (
            !isEvergreen &&
            batch.status !== BatchStatus.Upcoming &&
            batch.status !== BatchStatus.Running
        ) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                'This batch is not accepting new enrollments'
            );
        }

        // 3. Enrollment window (skipped for evergreen lifetime access)
        const now = new Date();
        if (!isEvergreen && now > batch.enrollmentEndDate) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                'Enrollment period has ended for this batch'
            );
        }

        // 4. Duplicate check: no terminal enrollment for same user+batch
        const existingTerminal = await EnrollmentModel.findOne({
            userId,
            batchId,
            status: {
                $in: [
                    EnrollmentStatus.Active,
                    EnrollmentStatus.Completed,
                    EnrollmentStatus.Suspended,
                ],
            },
        })
            .session(session)
            .lean();

        if (existingTerminal) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'You are already enrolled in this batch'
            );
        }

        // 5. Derive initial status from source/accessType
        let initialStatus: EnrollmentStatus;
        if (source === 'admin' && accessType === 'special') {
            initialStatus = EnrollmentStatus.Active;
        } else if (source === 'manual-payment') {
            initialStatus = EnrollmentStatus.PaymentPending;
        } else {
            initialStatus = EnrollmentStatus.Pending;
        }

        // 6. Generate enrollment ID
        const batchNumber = parseBatchNumber(batch);
        const courseBrand = deriveCourseBrand(batch.courseId as any);
        const enrollmentId = await generateEnrollmentId(batchNumber, courseBrand);

        // 7. Create enrollment
        const created = await EnrollmentModel.create(
            [
                {
                    userId,
                    batchId,
                    status: initialStatus,
                    accessType,
                    enrollmentId,
                    ...(initialStatus === EnrollmentStatus.Active
                        ? { enrolledAt: new Date() }
                        : {}),
                },
            ],
            { session }
        );

        const enrollment = created[0];

        // 8. Append-only status history inside the same transaction
        await EnrollmentStatusHistoryModel.create(
            [
                {
                    enrollmentId: enrollment._id,
                    userId,
                    batchId: enrollment.batchId as mongoose.Types.ObjectId,
                    from: EnrollmentStatus.Pending,
                    to: initialStatus,
                    actorType: actor?.role ? 'admin' : 'system',
                    actorId: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                    reason:
                        source === 'admin'
                            ? 'Admin granted access'
                            : source === 'manual-payment'
                              ? 'Manual payment enrollment'
                              : 'Learner initiated enrollment',
                    source:
                        source === 'admin'
                            ? 'POST /api/v1/enrollments/grant-access'
                            : source === 'manual-payment'
                              ? 'POST /api/v1/enrollments/manual'
                              : 'POST /api/v1/enrollments',
                },
            ],
            { session }
        );

        // 9. Seat counter only when entering Active at creation
        if (initialStatus === EnrollmentStatus.Active) {
            await BatchModel.findByIdAndUpdate(
                batch._id,
                { $inc: { currentEnrollment: 1 } },
                { session }
            );
        }

        if (shouldOwnTransaction) {
            await session.commitTransaction();
        }

        return {
            enrollment,
            batch,
            isNew: true,
            initialStatus,
        };
    } catch (error) {
        if (shouldOwnTransaction && session.inTransaction()) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (shouldOwnTransaction) {
            session.endSession();
        }
    }
};

/**
 * Initiate enrollment for a batch
 * With idempotency - returns existing pending enrollment if found
 */
const initiateEnrollment = async (userId: string, batchId: string) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        // 1. Terminal enrollment check — throws ENROLLMENT_ALREADY_EXISTS
        // with stable error code and details for the client.
        const terminal = await EnrollmentModel.findOne({
            userId,
            batchId,
            status: {
                $in: [
                    EnrollmentStatus.Active,
                    EnrollmentStatus.Completed,
                    EnrollmentStatus.Suspended,
                ],
            },
        })
            .select('_id enrollmentId batchId status')
            .session(session)
            .lean();

        if (terminal) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'You are already enrolled in this batch',
                '',
                {
                    code: 'ENROLLMENT_ALREADY_EXISTS',
                    details: {
                        status: terminal.status,
                        enrollmentRecordId: terminal._id.toString(),
                        batchId: terminal.batchId.toString(),
                    },
                }
            );
        }

        // 2. Idempotency + failed-payment replacement for pending rows.
        const existingPending = await EnrollmentModel.findOne({
            userId,
            batchId,
            status: {
                $in: [
                    EnrollmentStatus.Pending,
                    EnrollmentStatus.PaymentPending,
                ],
            },
        })
            .populate({ path: 'batchId', populate: { path: 'courseId', select: 'title slug brand' } })
            .session(session);

        if (existingPending) {
            // If a previous payment failed, mark the stale row PaymentFailed
            // and start a fresh enrollment instead of resurrecting it.
            const existingPayment = await PaymentModel.findOne({
                $or: [
                    ...(existingPending.enrollmentId
                        ? [{ enrollmentId: existingPending.enrollmentId }]
                        : []),
                    { userId, batchId },
                ],
                status: { $in: [Status.Failed, Status.Cancel] },
            })
                .select('status')
                .session(session)
                .lean();

            if (
                existingPayment?.status === Status.Failed ||
                existingPayment?.status === Status.Cancel
            ) {
                await EnrollmentModel.updateOne(
                    { _id: existingPending._id },
                    {
                        $set: {
                            status: EnrollmentStatus.PaymentFailed,
                            statusChangeReason: `Retry started after payment ${existingPayment.status}`,
                        },
                    },
                    { session }
                );

                // Create a fresh Pending enrollment through the shared path.
                const { enrollment, batch: batchObj } = await createEnrollment({
                    userId,
                    batchId,
                    source: 'self',
                    accessType: 'standard',
                    externalSession: session,
                });

                await session.commitTransaction();

                return {
                    enrollment,
                    batch: batchObj,
                    isExisting: false,
                };
            }

            // Idempotent: return the existing pending enrollment.
            await session.commitTransaction();
            return {
                enrollment: existingPending,
                batch: existingPending.batchId,
                isExisting: true,
            };
        }

        // 3. No existing row — create through the shared entry point.
        const { enrollment, batch: batchObj } = await createEnrollment({
            userId,
            batchId,
            source: 'self',
            accessType: 'standard',
            externalSession: session,
        });

        await session.commitTransaction();

        return {
            enrollment,
            batch: batchObj,
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
    // Normalize identifiers: UTRs are case/whitespace-insensitive on the
    // provider side — without this, "abc 123" vs "ABC123" bypasses dedupe.
    const submittedUtr = paymentData.transactionId.replace(/\s+/g, '').toUpperCase();
    const senderNumber = paymentData.senderNumber.replace(/[\s-]+/g, '');

    // Duplicate UTR check (must happen before creating enrollment, outside txn)
    const duplicateUtrPayment = await PaymentModel.findOne({
        'gatewayResponse.phonePeTransactionId': submittedUtr,
    }).lean();

    if (duplicateUtrPayment) {
        throw new ApiError(
            StatusCodes.CONFLICT,
            'This transaction ID has already been submitted. Please use your original submission or contact support.'
        );
    }

    const session = await mongoose.startSession();

    try {
        await session.startTransaction();

        // createEnrollment enforces: user active, batch accepting, window open,
        // no terminal enrollment, creates PaymentPending row + status history.
        const { enrollment, batch } = await createEnrollment({
            userId,
            batchId,
            source: 'manual-payment',
            accessType: 'standard',
        });

        const courseBrand = deriveCourseBrand(batch.courseId as any);
        const brand = courseBrand;
        const isEnglishCourse = brand === CourseBrand.EP;
        const manualPaymentAmount =
            typeof (batch as any).manualPaymentPrice === 'number'
                ? (batch as any).manualPaymentPrice
                : isEnglishCourse
                    ? 2289
                    : 3661;

        // Manual-channel currency follows the brand: EP collects via PhonePe
        // India (INR), MA via bKash/Nagad (BDT). Storing INR amounts as BDT
        // corrupts every revenue report downstream.
        const manualCurrency = isEnglishCourse ? 'INR' : 'BDT';
        const paymentTransactionId = generateTransactionId();

        try {
            await PaymentModel.findOneAndUpdate(
                { enrollmentId: enrollment.enrollmentId },
                {
                    $set: {
                        userId,
                        batchId,
                        transactionId: paymentTransactionId,
                        amount: manualPaymentAmount,
                        currency: manualCurrency,
                        status: Status.Review,
                        method: 'PhonePay',
                        enrollmentId: enrollment.enrollmentId,
                        // Dot-notation so the submissions history below survives.
                        'gatewayResponse.senderNumber': senderNumber,
                        'gatewayResponse.phonePeTransactionId': submittedUtr,
                        'gatewayResponse.submittedAt': new Date(),
                    },
                    // Append-only submission history: a retry with a different
                    // UTR must not destroy the originally submitted proof.
                    $push: {
                        'gatewayResponse.submissions': {
                            senderNumber,
                            phonePeTransactionId: submittedUtr,
                            submittedAt: new Date(),
                        },
                    },
                },
                {
                    session,
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true,
                }
            );
        } catch (error: any) {
            if (error?.code === 11000) {
                throw new ApiError(
                    StatusCodes.CONFLICT,
                    'This transaction ID has already been submitted. Please contact support.'
                );
            }
            throw error;
        }

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

const grantAccessByEmail = async (
    email: string,
    courseId: string,
    batchId: string,
    actor?: { id: string; role?: string },
    ip?: string
) => {
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

        // User-active, batch-open, window, and duplicate checks live in
        // createEnrollment (single source of truth for all entry points).

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
            // No existing enrollment: create through the shared entry point.
            const result = await EnrollmentService.createEnrollment({
                userId: user._id.toString(),
                batchId: batch._id.toString(),
                source: 'admin',
                accessType: 'special',
                actor,
            });
            enrollment = result.enrollment as any;
        } else {
            // Existing non-terminal enrollment (Pending, PaymentFailed, Expired,
            // Refunded): transition to Active via guarded CAS. Seat counter only
            // increments if moving into Active from a non-active state.
            enrollment = await EnrollmentService.transitionEnrollment(
                enrollment._id.toString(),
                enrollment.status as EnrollmentStatus,
                EnrollmentStatus.Active,
                actor,
                'Admin granted access (existing enrollment)'
            );
        }

        if (!enrollment) {
            throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to create or transition enrollment');
        }

        await assignStudentIdIfMissing(user._id.toString(), session);

        if (enrollment.enrollmentId) {
            await ProfileService.createOrUpdateProfileAfterEnrollment(
                user._id.toString(),
                enrollment.enrollmentId,
                session
            );
        }

        await session.commitTransaction();

        await recordAudit({
            actor: actor?.id,
            actorRole: actor?.role,
            action: 'enrollment.grant_access',
            targetType: 'Enrollment',
            targetId: enrollment._id?.toString(),
            metadata: {
                email: normalizedEmail,
                courseId,
                batchId,
                enrollmentId: enrollment.enrollmentId,
                wasActive,
            },
            ip,
        });

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
    // Sanitize pagination: raw query strings can be non-numeric (NaN $skip
    // throws) — clamp to sane bounds.
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 10));

    const pipeline: any[] = [];

    const matchStage: any = {};
    matchStage.enrollmentId = { $exists: true, $ne: null };
    // Invalid statuses 400 loudly: silently defaulting to Active hides fraud
    // hunts (pending/payment-pending/refunded searches returning Active rows).
    // Absent status keeps the historical Active default for the admin UI.
    let requestedStatus: EnrollmentStatus = EnrollmentStatus.Active;
    if (statusParam !== undefined) {
        if (typeof statusParam !== 'string' || !(Object.values(EnrollmentStatus) as string[]).includes(statusParam)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid enrollment status');
        }
        requestedStatus = statusParam as EnrollmentStatus;
    }
    matchStage.status = requestedStatus;
    if (batchId) {
        // Mirror the courseId guard below: an invalid id is a 400, not a
        // BSONError 500 (new ObjectId() throws outside CastError handling).
        if (typeof batchId !== 'string' || !mongoose.Types.ObjectId.isValid(batchId)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid batchId');
        }
        matchStage.batchId = new mongoose.Types.ObjectId(batchId);
    }

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

/**
 * Admin: update an enrollment's status. Values are validated against
 * EnrollmentStatus (lowercase) — runs validators so capitalized/unknown
 * values are rejected instead of corrupting the row — and the optional
 * reason is persisted to statusChangeReason. Transitions are constrained to
 * a conservative state machine so Active↔Pending ping-pong, Completed
 * resurrection, or finance-orphaning jumps can't happen from this endpoint
 * (refunds/revokes move status through their own audited flows).
 */
const ALLOWED_ENROLLMENT_TRANSITIONS: Record<string, string[]> = {
    [EnrollmentStatus.Pending]: [EnrollmentStatus.Active, EnrollmentStatus.Suspended],
    [EnrollmentStatus.PaymentPending]: [EnrollmentStatus.Active, EnrollmentStatus.Suspended],
    [EnrollmentStatus.PaymentFailed]: [EnrollmentStatus.Pending],
    [EnrollmentStatus.Expired]: [EnrollmentStatus.Pending],
    [EnrollmentStatus.Active]: [EnrollmentStatus.Suspended, EnrollmentStatus.Completed, EnrollmentStatus.Refunded],
    [EnrollmentStatus.Suspended]: [EnrollmentStatus.Active],
    [EnrollmentStatus.Completed]: [],
    [EnrollmentStatus.Refunded]: [],
};

/**
 * Guards an enrollment status transition with compare-and-set on the current
 * status, inside a transaction, with append-only status history. The caller is
 * responsible for validating the transition is business-valid (e.g. via
 * ALLOWED_ENROLLMENT_TRANSITIONS in updateEnrollmentStatus or certificate
 * eligibility before approve). This is the single primitive that every code
 * path changing an enrollment's status must use.
 */
const transitionEnrollment = async (
    enrollmentId: string,
    from: EnrollmentStatus,
    to: EnrollmentStatus,
    actor?: { id: string; role?: string },
    reason?: string,
    externalSession?: mongoose.ClientSession
) => {
    const shouldOwnTransaction = !externalSession;
    const session = externalSession ?? await mongoose.startSession();

    try {
        if (shouldOwnTransaction) {
            await session.startTransaction();
        }

        const enrollment = await EnrollmentModel.findOneAndUpdate(
            { _id: enrollmentId, status: from },
            {
                $set: {
                    status: to,
                    ...(reason !== undefined ? { statusChangeReason: reason } : {}),
                },
            },
            { new: true, session }
        );
        if (!enrollment) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                `Cannot transition enrollment: not in ${from} state (may have changed concurrently)`
            );
        }

        // Seat counter: only when moving INTO Active from a non-active state
        if (to === EnrollmentStatus.Active && from !== EnrollmentStatus.Active) {
            await BatchModel.findByIdAndUpdate(
                enrollment.batchId as mongoose.Types.ObjectId,
                { $inc: { currentEnrollment: 1 } },
                { session }
            );
        }

        // Append-only status history inside the same transaction
        await EnrollmentStatusHistoryModel.create([
            {
                enrollmentId: enrollment._id,
                userId: enrollment.userId,
                batchId: enrollment.batchId as mongoose.Types.ObjectId,
                from,
                to,
                actorType: actor?.role ? 'admin' : 'system',
                actorId: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                reason: reason ?? undefined,
                source: 'internal',
            },
        ], { session });

        if (shouldOwnTransaction) {
            await session.commitTransaction();
        }
        return enrollment;
    } catch (error) {
        if (shouldOwnTransaction && session.inTransaction()) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (shouldOwnTransaction) {
            session.endSession();
        }
    }
};

/**
 * Admin: update an enrollment's status. Values are validated against
 * EnrollmentStatus (lowercase) — runs validators so capitalized/unknown
 * values are rejected instead of corrupting the row — and the optional
 * reason is persisted to statusChangeReason. Transitions are constrained to
 * a conservative state machine so Active↔Pending ping-pong, Completed
 * resurrection, or finance-orphaning jumps can't happen from this endpoint
 * (refunds/revokes move status through their own audited flows).
 */
const updateEnrollmentStatus = async (
    enrollmentId: string,
    status: EnrollmentStatus,
    reason?: string,
    actor?: { id: string; role?: string }
) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const enrollment = await EnrollmentModel.findById(enrollmentId).session(session).lean();
        if (!enrollment) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
        }

        const fromStatus = enrollment.status as EnrollmentStatus;
        const allowed = ALLOWED_ENROLLMENT_TRANSITIONS[enrollment.status] ?? [];
        if (enrollment.status !== status && !allowed.includes(status)) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                `Cannot transition enrollment from ${enrollment.status} to ${status}`
            );
        }

        // Channel-specific activation prep (enrollment ID + student ID) happens
        // before the guarded transition so the MA- ID exists on the row.
        if (status === EnrollmentStatus.Active && fromStatus !== EnrollmentStatus.Active) {
            const batch = await BatchModel.findById(
                (enrollment as any).batchId
            ).populate({ path: 'courseId' }).session(session).lean();
            if (!batch) {
                throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
            }
            if (!(enrollment as any).enrollmentId) {
                (enrollment as any).enrollmentId = await generateEnrollmentId(
                    parseBatchNumber(batch),
                    deriveCourseBrand((batch as any)?.courseId)
                );
                // Persist the generated enrollmentId on the row before transitioning
                await EnrollmentModel.findByIdAndUpdate(
                    enrollmentId,
                    { enrollmentId: (enrollment as any).enrollmentId },
                    { session }
                );
            }
            await assignStudentIdIfMissing((enrollment as any).userId.toString(), session);
        }

        const result = await transitionEnrollment(
            enrollmentId,
            fromStatus,
            status,
            actor,
            reason,
            session
        );
        await session.commitTransaction();
        return result;
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        session.endSession();
    }
};

export const EnrollmentService = {
    initiateEnrollment,
    enrollWithManualPayment,
    grantAccessByEmail,
    getSpecialAccessEnrollments,
    getUserEnrollments,
    getEnrollmentDetails,
    getAllEnrollments,
    updateEnrollmentStatus,
    createEnrollment,
    transitionEnrollment,
    initializeModuleProgress,
    generateEnrollmentId,
    ensureStudentIdForUser,
};
