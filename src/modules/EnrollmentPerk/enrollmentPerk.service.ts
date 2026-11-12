import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { EnrollmentPerkRuleModel } from './enrollmentPerkRule.model.js';
import { PerkGrantModel } from './perkGrant.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { BatchModel, IBatch } from '../Batch/batch.model.js';
import { CourseModel } from '../Course/course.model.js';
import { UserModel } from '../User/user.model.js';
import { PaymentModel } from '../Payment/payment.model.js';
import { EnrollmentStatusHistoryModel } from '../Enrollment/enrollmentStatusHistory.model.js';
import { NotificationService } from '../Notification/notification.service.js';
import { BatchStatus, EnrollmentStatus, Status } from '../../types/common.js';
import { deriveCourseBrand } from '../../utils/courseBrand.js';
import {
    IEnrollmentPerkRule,
    PerkBenefitType,
} from './enrollmentPerk.interface.js';
import crypto from 'crypto';
import { BootcampCatalogModel } from '../Bootcamp/bootcampCatalog.model.js';
import { BootcampPurchaseModel } from '../Bootcamp/bootcampPurchase.model.js';
import { BootcampPurchaseStatus } from '../Bootcamp/bootcampCatalog.interface.js';
import { logger } from '../../config/logger.js';

// Helper to parse numeric batch number from a batch
const parseBatchNumber = (batch: any): number => {
    if (typeof batch.batchNumber === 'number' && !isNaN(batch.batchNumber)) {
        return batch.batchNumber;
    }
    const match = String(batch.title || '').match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
};

// Generate enrollment ID for perk-granted course
const generatePerkEnrollmentId = async (
    batchNumber: number,
    courseBrand: string,
    session?: mongoose.ClientSession
): Promise<string> => {
    const paddedBatch = String(batchNumber).padStart(2, '0');
    const prefix = `${courseBrand}-${paddedBatch}-`;
    
    // Count existing enrollments matching prefix to get sequence
    const count = await EnrollmentModel.countDocuments({
        enrollmentId: { $regex: `^${prefix}` },
    }).session(session || null);

    const sequence = String(count + 1).padStart(4, '0');
    return `${prefix}${sequence}`;
};

/**
 * Create a new Perk Rule
 */
const createRule = async (
    payload: Partial<IEnrollmentPerkRule>,
    createdBy: string
) => {
    const { courseId, batchId, title, isActive = true, startDate, endDate, note, revokeOnCancel = true, applyToAdminGrants = true, benefits } = payload;

    if (!courseId || !batchId || !title || !benefits || benefits.length === 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Course, batch, title, and at least one benefit are required');
    }

    // 1. Verify Course exists
    const course = await CourseModel.findById(courseId).lean();
    if (!course) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Selected course not found');
    }

    // 2. Verify Batch exists and belongs to Course
    const batch = await BatchModel.findById(batchId).lean();
    if (!batch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Selected batch not found');
    }

    const batchCourseId = (batch.courseId as any)?._id?.toString() ?? batch.courseId?.toString();
    if (batchCourseId !== courseId.toString()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Selected batch does not belong to the selected course');
    }

    // 3. Verify benefits and ensure target courses exist and are not the same as source course
    for (const b of benefits) {
        if (b.type === PerkBenefitType.FreeCourse) {
            if (!b.targetCourseId) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Target course is required for free course access benefit');
            }
            if (b.targetCourseId.toString() === courseId.toString()) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'A benefit course cannot be the same as the enrolled course');
            }
            const targetCourse = await CourseModel.findById(b.targetCourseId).lean();
            if (!targetCourse) {
                throw new ApiError(StatusCodes.NOT_FOUND, `Target benefit course (${b.targetCourseId}) not found`);
            }
            if (b.targetBatchId) {
                const targetBatch = await BatchModel.findById(b.targetBatchId).lean();
                if (!targetBatch) {
                    throw new ApiError(StatusCodes.NOT_FOUND, `Target benefit batch (${b.targetBatchId}) not found`);
                }
                const targetBatchCourseId = (targetBatch.courseId as any)?._id?.toString() ?? targetBatch.courseId?.toString();
                if (targetBatchCourseId !== b.targetCourseId.toString()) {
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target benefit batch does not belong to the target benefit course');
                }
            }
        } else if (b.type === PerkBenefitType.FreeBootcamp) {
            if (!b.targetBootcampId) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Target bootcamp is required for free bootcamp access benefit');
            }
            const targetBootcamp = await BootcampCatalogModel.findById(b.targetBootcampId).lean();
            if (!targetBootcamp) {
                throw new ApiError(StatusCodes.NOT_FOUND, `Target benefit bootcamp (${b.targetBootcampId}) not found`);
            }
        }
    }

    // 4. Validate duplicate active rule for the same course + batch
    if (isActive) {
        const existingActiveRule = await EnrollmentPerkRuleModel.findOne({
            courseId,
            batchId,
            isActive: true,
        }).lean();

        if (existingActiveRule) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'An active perk rule already exists for this course and batch. Please deactivate the existing rule first.'
            );
        }
    }

    // 5. Create rule
    const rule = await EnrollmentPerkRuleModel.create({
        courseId,
        batchId,
        title: title.trim(),
        isActive,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        note: note ? note.trim() : undefined,
        revokeOnCancel,
        applyToAdminGrants,
        benefits,
        createdBy: new mongoose.Types.ObjectId(createdBy),
    });

    return rule;
};

/**
 * Update an existing Perk Rule
 */
const updateRule = async (
    id: string,
    payload: Partial<IEnrollmentPerkRule>
) => {
    const rule = await EnrollmentPerkRuleModel.findById(id);
    if (!rule) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Perk rule not found');
    }

    const courseId = payload.courseId ? payload.courseId.toString() : rule.courseId.toString();
    const batchId = payload.batchId ? payload.batchId.toString() : rule.batchId.toString();
    const targetIsActive = payload.isActive !== undefined ? payload.isActive : rule.isActive;

    // Validate course & batch if modified
    if (payload.courseId || payload.batchId) {
        const course = await CourseModel.findById(courseId).lean();
        if (!course) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Selected course not found');
        }
        const batch = await BatchModel.findById(batchId).lean();
        if (!batch) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Selected batch not found');
        }
        const batchCourseId = (batch.courseId as any)?._id?.toString() ?? batch.courseId?.toString();
        if (batchCourseId !== courseId) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Selected batch does not belong to the selected course');
        }
    }

    // Validate benefits if modified
    const benefits = payload.benefits || rule.benefits;
    if (payload.benefits) {
        for (const b of benefits) {
            if (b.type === PerkBenefitType.FreeCourse) {
                if (!b.targetCourseId) {
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target course is required for free course access benefit');
                }
                if (b.targetCourseId.toString() === courseId) {
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'A benefit course cannot be the same as the enrolled course');
                }
                const targetCourse = await CourseModel.findById(b.targetCourseId).lean();
                if (!targetCourse) {
                    throw new ApiError(StatusCodes.NOT_FOUND, `Target benefit course (${b.targetCourseId}) not found`);
                }
                if (b.targetBatchId) {
                    const targetBatch = await BatchModel.findById(b.targetBatchId).lean();
                    if (!targetBatch) {
                        throw new ApiError(StatusCodes.NOT_FOUND, `Target benefit batch (${b.targetBatchId}) not found`);
                    }
                    const targetBatchCourseId = (targetBatch.courseId as any)?._id?.toString() ?? targetBatch.courseId?.toString();
                    if (targetBatchCourseId !== b.targetCourseId.toString()) {
                        throw new ApiError(StatusCodes.BAD_REQUEST, 'Target benefit batch does not belong to the target benefit course');
                    }
                }
            } else if (b.type === PerkBenefitType.FreeBootcamp) {
                if (!b.targetBootcampId) {
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'Target bootcamp is required for free bootcamp access benefit');
                }
                const targetBootcamp = await BootcampCatalogModel.findById(b.targetBootcampId).lean();
                if (!targetBootcamp) {
                    throw new ApiError(StatusCodes.NOT_FOUND, `Target benefit bootcamp (${b.targetBootcampId}) not found`);
                }
            }
        }
    }

    // Check duplicate active rule if activating or moving to another course/batch
    if (targetIsActive) {
        const duplicateRule = await EnrollmentPerkRuleModel.findOne({
            _id: { $ne: rule._id },
            courseId,
            batchId,
            isActive: true,
        }).lean();

        if (duplicateRule) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Another active perk rule already exists for this course and batch'
            );
        }
    }

    // Apply updates
    if (payload.title !== undefined) rule.title = payload.title.trim();
    if (payload.courseId !== undefined) rule.courseId = new mongoose.Types.ObjectId(payload.courseId as any);
    if (payload.batchId !== undefined) rule.batchId = new mongoose.Types.ObjectId(payload.batchId as any);
    if (payload.isActive !== undefined) rule.isActive = payload.isActive;
    if (payload.startDate !== undefined) rule.startDate = payload.startDate ? new Date(payload.startDate) : undefined;
    if (payload.endDate !== undefined) rule.endDate = payload.endDate ? new Date(payload.endDate) : undefined;
    if (payload.note !== undefined) rule.note = payload.note ? payload.note.trim() : undefined;
    if (payload.revokeOnCancel !== undefined) rule.revokeOnCancel = payload.revokeOnCancel;
    if (payload.applyToAdminGrants !== undefined) rule.applyToAdminGrants = payload.applyToAdminGrants;
    if (payload.benefits !== undefined) rule.benefits = payload.benefits;

    await rule.save();
    return rule;
};

/**
 * Toggle Perk Rule active status
 */
const toggleRuleStatus = async (id: string, isActive: boolean) => {
    const rule = await EnrollmentPerkRuleModel.findById(id);
    if (!rule) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Perk rule not found');
    }

    if (isActive) {
        const existingActive = await EnrollmentPerkRuleModel.findOne({
            _id: { $ne: rule._id },
            courseId: rule.courseId,
            batchId: rule.batchId,
            isActive: true,
        }).lean();

        if (existingActive) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Another active perk rule already exists for this course and batch'
            );
        }
    }

    rule.isActive = isActive;
    await rule.save();
    return rule;
};

/**
 * Delete a Perk Rule
 */
const deleteRule = async (id: string) => {
    const rule = await EnrollmentPerkRuleModel.findById(id);
    if (!rule) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Perk rule not found');
    }

    await EnrollmentPerkRuleModel.findByIdAndDelete(id);
    return { success: true, message: 'Perk rule deleted successfully' };
};

/**
 * Get single rule by ID
 */
const getRuleById = async (id: string) => {
    const rule = await EnrollmentPerkRuleModel.findById(id)
        .populate('courseId', 'title slug thumbnailImage')
        .populate('batchId', 'title batchNumber status')
        .populate('benefits.targetCourseId', 'title slug thumbnailImage')
        .populate('benefits.targetBatchId', 'title batchNumber status')
        .populate('benefits.targetBootcampId', 'title season slug thumbnail posterImage')
        .populate('createdBy', 'name email')
        .lean();

    if (!rule) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Perk rule not found');
    }
    return rule;
};

/**
 * List Perk Rules with filters & pagination
 */
const listRules = async (query: {
    courseId?: string;
    batchId?: string;
    isActive?: string;
    search?: string;
    page?: number;
    limit?: number;
}) => {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 10)));
    const filter: Record<string, any> = {};

    if (query.courseId) {
        filter.courseId = query.courseId;
    }
    if (query.batchId) {
        filter.batchId = query.batchId;
    }
    if (query.isActive !== undefined && query.isActive !== 'all') {
        filter.isActive = query.isActive === 'true';
    }
    if (query.search?.trim()) {
        const searchRegex = new RegExp(query.search.trim(), 'i');
        filter.$or = [
            { title: searchRegex },
            { note: searchRegex },
        ];
    }

    const [data, total] = await Promise.all([
        EnrollmentPerkRuleModel.find(filter)
            .populate('courseId', 'title slug thumbnailImage')
            .populate('batchId', 'title batchNumber status')
            .populate('benefits.targetCourseId', 'title slug thumbnailImage')
            .populate('benefits.targetBatchId', 'title batchNumber status')
            .populate('benefits.targetBootcampId', 'title season slug thumbnail posterImage')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        EnrollmentPerkRuleModel.countDocuments(filter),
    ]);

    return {
        data,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/**
 * List Perk Grants (Audit / Grant logs)
 */
const listGrantLogs = async (query: {
    ruleId?: string;
    studentId?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
}) => {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 10)));
    const filter: Record<string, any> = {};

    if (query.ruleId) {
        filter.ruleId = query.ruleId;
    }
    if (query.studentId) {
        filter.studentId = query.studentId;
    }
    if (query.status && query.status !== 'all') {
        filter.status = query.status;
    }

    if (query.search?.trim()) {
        const matchingUsers = await UserModel.find({
            $or: [
                { email: new RegExp(query.search.trim(), 'i') },
                { name: new RegExp(query.search.trim(), 'i') },
            ],
        }).select('_id').lean();

        const userIds = matchingUsers.map((u) => u._id);
        filter.studentId = { $in: userIds };
    }

    const [data, total] = await Promise.all([
        PerkGrantModel.find(filter)
            .populate('studentId', 'name email avatar')
            .populate('ruleId', 'title courseId batchId')
            .populate('targetCourseId', 'title slug thumbnailImage')
            .populate('targetBatchId', 'title batchNumber')
            .populate('targetBootcampId', 'title season slug thumbnail posterImage')
            .populate('sourceEnrollmentId', 'enrollmentId batchId status')
            .populate('targetEnrollmentId', 'enrollmentId status')
            .populate('grantedBy', 'name email')
            .sort({ grantedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        PerkGrantModel.countDocuments(filter),
    ]);

    return {
        data,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/**
 * Helper: Resolve the best target batch for a given course.
 * If targetBatchId is provided and valid, use it.
 * Otherwise pick the latest active/running/upcoming or evergreen batch for the course.
 */
const resolveTargetBatch = async (
    targetCourseId: string,
    targetBatchId?: string,
    session?: mongoose.ClientSession
): Promise<IBatch | null> => {
    if (targetBatchId && mongoose.Types.ObjectId.isValid(targetBatchId)) {
        const batch = await BatchModel.findById(targetBatchId)
            .populate('courseId')
            .session(session || null)
            .lean();
        if (batch) return batch as unknown as IBatch;
    }

    // Find latest active, running, upcoming, or evergreen batch
    const candidateBatches = await BatchModel.find({
        courseId: targetCourseId,
        $or: [
            { status: { $in: [BatchStatus.Upcoming, BatchStatus.Running] } },
            { isEvergreen: true },
        ],
    })
        .populate('courseId')
        .sort({ isEvergreen: -1, startDate: -1, createdAt: -1 })
        .session(session || null)
        .lean();

    if (candidateBatches.length > 0) {
        return candidateBatches[0] as unknown as IBatch;
    }

    // Fallback: any latest batch of the target course
    const latestBatch = await BatchModel.findOne({ courseId: targetCourseId })
        .populate('courseId')
        .sort({ createdAt: -1 })
        .session(session || null)
        .lean();

    return latestBatch ? (latestBatch as unknown as IBatch) : null;
};

/**
 * Core Logic: Grant perks for a newly activated enrollment.
 * Must be idempotent: never double-grant to the same student.
 * Transactional: will execute inside caller session or own session.
 */
const grantPerksForEnrollment = async ({
    enrollmentId,
    session: externalSession,
    actor,
    isBackfill = false,
}: {
    enrollmentId: string;
    session?: mongoose.ClientSession;
    actor?: { id: string; role?: string };
    isBackfill?: boolean;
}): Promise<{ grantedCount: number; grants: any[] }> => {
    const shouldOwnTransaction = !externalSession;
    const session = externalSession ?? await mongoose.startSession();

    try {
        if (shouldOwnTransaction) {
            await session.startTransaction();
        }

        // 1. Fetch enrollment
        const enrollment = await EnrollmentModel.findById(enrollmentId)
            .session(session)
            .lean();

        if (!enrollment) {
            logger.warn({ enrollmentId }, 'Enrollment not found for perk evaluation');
            return { grantedCount: 0, grants: [] };
        }

        // Only active enrollments receive perks
        if (enrollment.status !== EnrollmentStatus.Active && enrollment.status !== EnrollmentStatus.Completed) {
            return { grantedCount: 0, grants: [] };
        }

        // If this enrollment was itself granted via a perk, do not trigger recursive perks
        if ((enrollment as any).grantedViaPerk) {
            return { grantedCount: 0, grants: [] };
        }

        // 2. Fetch source batch & course
        const batch = await BatchModel.findById(enrollment.batchId)
            .populate('courseId')
            .session(session)
            .lean();

        if (!batch) {
            return { grantedCount: 0, grants: [] };
        }

        const sourceCourseId = (batch.courseId as any)?._id?.toString() ?? batch.courseId?.toString();
        const sourceCourseTitle = (batch.courseId as any)?.title || 'Course';

        // 3. Find matching active perk rules for this course + batch
        const now = new Date();
        const rules = await EnrollmentPerkRuleModel.find({
            courseId: sourceCourseId,
            batchId: batch._id,
            isActive: true,
            $and: [
                {
                    $or: [
                        { startDate: { $exists: false } },
                        { startDate: null },
                        { startDate: { $lte: now } },
                    ],
                },
                {
                    $or: [
                        { endDate: { $exists: false } },
                        { endDate: null },
                        { endDate: { $gte: now } },
                    ],
                },
            ],
        })
            .session(session)
            .lean();

        if (!rules || rules.length === 0) {
            return { grantedCount: 0, grants: [] };
        }

        const isAdminGrant = enrollment.accessType === 'special';
        const grantedResults: any[] = [];

        for (const rule of rules) {
            // Check if admin grants are excluded
            if (isAdminGrant && rule.applyToAdminGrants === false) {
                continue;
            }

            for (const benefit of rule.benefits) {
                if (benefit.type === PerkBenefitType.FreeCourse && benefit.targetCourseId) {
                    const targetCourseId = benefit.targetCourseId.toString();

                    // Idempotency check 1: Has this student already received a perk grant for this target course from this source enrollment?
                    const existingGrant = await PerkGrantModel.findOne({
                        studentId: enrollment.userId,
                        targetCourseId,
                        status: 'granted',
                    })
                        .session(session)
                        .lean();

                    if (existingGrant) {
                        logger.info(
                            { userId: enrollment.userId, targetCourseId, ruleId: rule._id },
                            'Student already has an active perk grant for this target course — skipping duplicate'
                        );
                        continue;
                    }

                    // Idempotency check 2: Does the student already have an active or completed enrollment in the target course?
                    const targetBatches = await BatchModel.find({ courseId: targetCourseId })
                        .select('_id')
                        .session(session)
                        .lean();
                    const targetBatchIds = targetBatches.map((b) => b._id);

                    const existingEnrollmentInTarget = await EnrollmentModel.findOne({
                        userId: enrollment.userId,
                        batchId: { $in: targetBatchIds },
                        status: {
                            $in: [
                                EnrollmentStatus.Active,
                                EnrollmentStatus.Completed,
                            ],
                        },
                    })
                        .session(session)
                        .lean();

                    if (existingEnrollmentInTarget) {
                        // Record grant audit so we know the perk was processed, referencing the existing enrollment
                        const recordedGrant = await PerkGrantModel.create(
                            [
                                {
                                    studentId: enrollment.userId,
                                    ruleId: rule._id,
                                    benefitType: PerkBenefitType.FreeCourse,
                                    targetCourseId,
                                    targetBatchId: existingEnrollmentInTarget.batchId,
                                    targetEnrollmentId: existingEnrollmentInTarget._id,
                                    sourceEnrollmentId: enrollment._id,
                                    status: 'granted',
                                    grantedAt: new Date(),
                                    grantedBy: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                                },
                            ],
                            { session }
                        );
                        grantedResults.push(recordedGrant[0]);
                        continue;
                    }

                    // 4. Resolve target batch for the target course
                    const targetBatch = await resolveTargetBatch(
                        targetCourseId,
                        benefit.targetBatchId?.toString(),
                        session
                    );

                    if (!targetBatch) {
                        logger.error(
                            { targetCourseId },
                            'Cannot grant perk: target course has no available batches'
                        );
                        continue;
                    }

                    const targetCourse = (targetBatch.courseId as any) || (await CourseModel.findById(targetCourseId).lean());
                    const targetCourseBrand = deriveCourseBrand(targetCourse);
                    const targetBatchNumber = parseBatchNumber(targetBatch);

                    // Generate enrollment ID for the perk enrollment
                    const perkEnrollmentId = await generatePerkEnrollmentId(
                        targetBatchNumber,
                        targetCourseBrand,
                        session
                    );

                    // Determine duration
                    let accessExtendedUntil: Date | undefined;
                    if (benefit.accessDuration?.type === 'days' && benefit.accessDuration.days) {
                        accessExtendedUntil = new Date(Date.now() + benefit.accessDuration.days * 24 * 60 * 60 * 1000);
                    }

                    // 5. Create complimentary active enrollment for the bonus course
                    const createdEnrollment = await EnrollmentModel.create(
                        [
                            {
                                userId: enrollment.userId,
                                batchId: targetBatch._id,
                                enrollmentId: perkEnrollmentId,
                                status: EnrollmentStatus.Active,
                                accessType: 'special',
                                enrolledAt: new Date(),
                                accessExtendedUntil,
                                grantedViaPerk: true,
                                perkRuleId: rule._id,
                                perkSourceEnrollmentId: enrollment._id,
                            },
                        ],
                        { session }
                    );

                    const targetEnrollment = createdEnrollment[0];

                    // Append status history inside the same transaction
                    await EnrollmentStatusHistoryModel.create(
                        [
                            {
                                enrollmentId: targetEnrollment._id,
                                userId: enrollment.userId,
                                batchId: targetBatch._id,
                                from: EnrollmentStatus.Pending,
                                to: EnrollmentStatus.Active,
                                actorType: isBackfill ? 'admin' : 'system',
                                actorId: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                                reason: `Perk granted from rule "${rule.title}" (source enrollment ${enrollment.enrollmentId || enrollment._id})`,
                                source: 'perk_grant',
                            },
                        ],
                        { session }
                    );

                    // Create complimentary payment record so revenue and accounting stay clean
                    await PaymentModel.create(
                        [
                            {
                                userId: enrollment.userId,
                                batchId: targetBatch._id,
                                transactionId: `PERK-${perkEnrollmentId}`,
                                enrollmentId: perkEnrollmentId,
                                enrollmentRef: targetEnrollment._id,
                                amount: 0,
                                currency: 'BDT',
                                status: Status.Success,
                                method: 'complimentary',
                                gatewayResponse: {
                                    source: 'perk_grant',
                                    ruleId: rule._id,
                                    sourceEnrollmentId: enrollment._id,
                                    grantedAt: new Date(),
                                },
                                paidAt: new Date(),
                            },
                        ],
                        { session }
                    );

                    // 6. Record PerkGrant log
                    const grantRecord = await PerkGrantModel.create(
                        [
                            {
                                studentId: enrollment.userId,
                                ruleId: rule._id,
                                benefitType: PerkBenefitType.FreeCourse,
                                targetCourseId,
                                targetBatchId: targetBatch._id,
                                targetEnrollmentId: targetEnrollment._id,
                                sourceEnrollmentId: enrollment._id,
                                status: 'granted',
                                grantedAt: new Date(),
                                grantedBy: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                            },
                        ],
                        { session }
                    );

                    grantedResults.push(grantRecord[0]);

                    // 7. Notify student
                    try {
                        await NotificationService.createNotification({
                            userId: enrollment.userId.toString(),
                            type: 'access_granted',
                            title: 'Bonus Course Unlocked! 🎉',
                            message: `Congratulations! As a perk for enrolling in ${sourceCourseTitle}, you have received free access to ${targetCourse.title || 'a bonus course'}!`,
                            link: '/my-classes',
                            relatedTo: {
                                model: 'Enrollment',
                                id: targetEnrollment._id.toString(),
                            },
                        });
                    } catch (notifErr) {
                        logger.warn(notifErr, 'Failed to send perk notification');
                    }
                } else if (benefit.type === PerkBenefitType.FreeBootcamp && benefit.targetBootcampId) {
                    const targetBootcampId = benefit.targetBootcampId.toString();

                    // Idempotency check 1: Has this student already received a perk grant for this target bootcamp?
                    const existingGrant = await PerkGrantModel.findOne({
                        studentId: enrollment.userId,
                        targetBootcampId,
                        status: 'granted',
                    })
                        .session(session)
                        .lean();

                    if (existingGrant) {
                        logger.info(
                            { userId: enrollment.userId, targetBootcampId, ruleId: rule._id },
                            'Student already has an active perk grant for this target bootcamp — skipping duplicate'
                        );
                        continue;
                    }

                    // Idempotency check 2: Does the student already have an active/paid purchase for this bootcamp?
                    const existingPurchase = await BootcampPurchaseModel.findOne({
                        user: enrollment.userId,
                        bootcamp: targetBootcampId,
                        status: BootcampPurchaseStatus.Paid,
                    })
                        .session(session)
                        .lean();

                    if (existingPurchase) {
                        const recordedGrant = await PerkGrantModel.create(
                            [
                                {
                                    studentId: enrollment.userId,
                                    ruleId: rule._id,
                                    benefitType: PerkBenefitType.FreeBootcamp,
                                    targetBootcampId,
                                    targetBootcampPurchaseId: existingPurchase._id,
                                    sourceEnrollmentId: enrollment._id,
                                    status: 'granted',
                                    grantedAt: new Date(),
                                    grantedBy: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                                },
                            ],
                            { session }
                        );
                        grantedResults.push(recordedGrant[0]);
                        continue;
                    }

                    // Fetch target bootcamp
                    const targetBootcamp = await BootcampCatalogModel.findById(targetBootcampId)
                        .session(session)
                        .lean();

                    if (!targetBootcamp) {
                        logger.error({ targetBootcampId }, 'Target bootcamp not found for perk grant');
                        continue;
                    }

                    const randomSuffix = crypto.randomBytes(6).toString('hex').toUpperCase();
                    const tranId = `PERK-BC-${randomSuffix}`;

                    // Create complimentary paid purchase
                    const createdPurchase = await BootcampPurchaseModel.create(
                        [
                            {
                                user: enrollment.userId,
                                bootcamp: targetBootcamp._id,
                                amount: 0,
                                method: 'manual',
                                transactionId: tranId,
                                status: BootcampPurchaseStatus.Paid,
                                adminNote: `Granted via perk rule "${rule.title}" (source enrollment ${enrollment.enrollmentId || enrollment._id})`,
                                gatewayResponse: {
                                    source: 'perk_grant',
                                    ruleId: rule._id,
                                    sourceEnrollmentId: enrollment._id,
                                    grantedAt: new Date(),
                                },
                            },
                        ],
                        { session }
                    );

                    const targetPurchase = createdPurchase[0];

                    // Record grant log
                    const grantRecord = await PerkGrantModel.create(
                        [
                            {
                                studentId: enrollment.userId,
                                ruleId: rule._id,
                                benefitType: PerkBenefitType.FreeBootcamp,
                                targetBootcampId,
                                targetBootcampPurchaseId: targetPurchase._id,
                                sourceEnrollmentId: enrollment._id,
                                status: 'granted',
                                grantedAt: new Date(),
                                grantedBy: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                            },
                        ],
                        { session }
                    );

                    grantedResults.push(grantRecord[0]);

                    // Notify student
                    try {
                        await NotificationService.createNotification({
                            userId: enrollment.userId.toString(),
                            type: 'access_granted',
                            title: 'Bonus Bootcamp Unlocked! 🔥',
                            message: `Congratulations! As a perk for enrolling in ${sourceCourseTitle}, you have received free access to ${targetBootcamp.title || 'a bonus bootcamp'}!`,
                            link: '/my-classes',
                            relatedTo: {
                                model: 'Bootcamp',
                                id: targetBootcamp._id.toString(),
                            },
                        });
                    } catch (notifErr) {
                        logger.warn(notifErr, 'Failed to send bootcamp perk notification');
                    }
                }
            }
        }

        if (shouldOwnTransaction) {
            await session.commitTransaction();
        }

        return {
            grantedCount: grantedResults.length,
            grants: grantedResults,
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
 * Revoke perks when a source enrollment is refunded or cancelled
 */
const revokePerksForEnrollment = async ({
    sourceEnrollmentId,
    session: externalSession,
    actor,
    reason = 'Source enrollment cancelled or refunded',
}: {
    sourceEnrollmentId: string;
    session?: mongoose.ClientSession;
    actor?: { id: string; role?: string };
    reason?: string;
}): Promise<{ revokedCount: number }> => {
    const shouldOwnTransaction = !externalSession;
    const session = externalSession ?? await mongoose.startSession();

    try {
        if (shouldOwnTransaction) {
            await session.startTransaction();
        }

        // Find active grants linked to this source enrollment
        const grants = await PerkGrantModel.find({
            sourceEnrollmentId,
            status: 'granted',
        })
            .populate('ruleId')
            .session(session);

        let revokedCount = 0;

        for (const grant of grants) {
            const rule = grant.ruleId as any;
            // Check if rule specifies revoke on cancel (default true)
            if (rule && rule.revokeOnCancel === false) {
                continue;
            }

            if (grant.targetEnrollmentId) {
                // Suspend/revoke target enrollment
                const targetEnrollment = await EnrollmentModel.findByIdAndUpdate(
                    grant.targetEnrollmentId,
                    {
                        $set: {
                            status: EnrollmentStatus.Suspended,
                            statusChangeReason: `Perk revoked: ${reason}`,
                        },
                    },
                    { session, new: true }
                );

                if (targetEnrollment) {
                    await EnrollmentStatusHistoryModel.create(
                        [
                            {
                                enrollmentId: targetEnrollment._id,
                                userId: targetEnrollment.userId,
                                batchId: targetEnrollment.batchId as mongoose.Types.ObjectId,
                                from: targetEnrollment.status,
                                to: EnrollmentStatus.Suspended,
                                actorType: actor?.role ? 'admin' : 'system',
                                actorId: actor?.id ? new mongoose.Types.ObjectId(actor.id) : undefined,
                                reason: `Perk revoked: ${reason}`,
                                source: 'perk_revocation',
                            },
                        ],
                        { session }
                    );
                }
            }

            if (grant.targetBootcampId) {
                await BootcampPurchaseModel.updateMany(
                    {
                        user: grant.studentId,
                        bootcamp: grant.targetBootcampId,
                        'gatewayResponse.source': 'perk_grant',
                    },
                    {
                        $set: {
                            status: BootcampPurchaseStatus.Rejected,
                            adminNote: `Perk revoked: ${reason}`,
                        },
                    },
                    { session }
                );
            }

            grant.status = 'revoked';
            grant.revokedAt = new Date();
            grant.revokeReason = reason;
            await grant.save({ session });
            revokedCount++;
        }

        if (shouldOwnTransaction) {
            await session.commitTransaction();
        }

        return { revokedCount };
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
 * Preview backfill for existing students enrolled in a rule's batch
 */
const previewBackfill = async (ruleId: string) => {
    const rule = await EnrollmentPerkRuleModel.findById(ruleId).lean();
    if (!rule) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Perk rule not found');
    }

    // Find all active/completed enrollments in this batch
    const enrollments = await EnrollmentModel.find({
        batchId: rule.batchId,
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
        grantedViaPerk: { $ne: true },
    })
        .populate('userId', 'name email')
        .lean();

    // Check which ones do not already have grants for this rule
    const existingGrants = await PerkGrantModel.find({
        ruleId: rule._id,
        status: 'granted',
    })
        .select('studentId')
        .lean();

    const grantedUserIds = new Set(existingGrants.map((g) => g.studentId.toString()));

    const eligible = enrollments.filter(
        (e) => e.userId && !grantedUserIds.has((e.userId as any)._id?.toString())
    );

    return {
        ruleId,
        ruleTitle: rule.title,
        totalEnrolled: enrollments.length,
        eligibleCount: eligible.length,
        eligibleStudents: eligible.map((e) => ({
            enrollmentId: e._id,
            studentId: (e.userId as any)._id,
            name: (e.userId as any).name,
            email: (e.userId as any).email,
        })),
    };
};

/**
 * Execute backfill for existing enrolled students
 */
const executeBackfill = async (
    ruleId: string,
    actor: { id: string; role?: string }
) => {
    const preview = await previewBackfill(ruleId);
    let totalGranted = 0;

    for (const student of preview.eligibleStudents) {
        try {
            const res = await grantPerksForEnrollment({
                enrollmentId: student.enrollmentId.toString(),
                actor,
                isBackfill: true,
            });
            totalGranted += res.grantedCount;
        } catch (err) {
            logger.error(
                { enrollmentId: student.enrollmentId, err },
                'Failed to backfill perk for student enrollment'
            );
        }
    }

    return {
        ruleId,
        totalEligible: preview.eligibleCount,
        totalGranted,
    };
};

export const EnrollmentPerkService = {
    createRule,
    updateRule,
    toggleRuleStatus,
    deleteRule,
    getRuleById,
    listRules,
    listGrantLogs,
    grantPerksForEnrollment,
    revokePerksForEnrollment,
    previewBackfill,
    executeBackfill,
};
