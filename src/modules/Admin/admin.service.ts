import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiError.js";
import { UserModel } from "../User/user.model.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import { BatchModel } from "../Batch/batch.model.js";
import { CourseModel } from "../Course/course.model.js";
import { ModuleModel } from "../Module/module.model.js";
import { LessonProgressModel } from "../Progress/lessonProgress.model.js";
import { ModuleProgressModel } from "../Progress/moduleProgress.model.js";
import { BatchStatus, EnrollmentStatus, LessonProgressStatus, UserStatus } from "../../types/common.js";
import { Role } from "../../types/role.js";
import { getAuth } from "../../config/betterAuth.js";
import { recordAudit } from "../../models/auditLog.model.js";
import { logger } from "../../config/logger.js";
import mongoose from "mongoose";
import { sendEnrollmentReminderEmail, sendNewsUpdateEmail } from "../../services/misunAcademyEmails.js";
import { sendCourseCompletedBatchIncompleteReminderEmail, sendCourseRunningBatchProgressReminderEmail } from "../../services/courseEmailRouter.js";

const login = async (email: string, password: string) => {
    const auth = getAuth();

    let session: any;
    try {
        session = await auth.api.signInEmail({
            body: { email, password },
            asResponse: false,
        });
    } catch (err: any) {
        const msg = err?.body?.message || err?.message || 'Invalid credentials';
        throw new ApiError(StatusCodes.UNAUTHORIZED, msg);
    }

    if (!session?.user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
    }

    const user = await UserModel.findOne({ email }).select('name email role status').lean();

    return {
        token: session.session?.token || '',
        user: {
            name: user?.name || session.user.name,
            email: session.user.email,
            role: user?.role,
        },
    };
};

const attachEnrollmentInfo = async (users: any[]) => {
    if (users.length === 0) {
        return users.map((user) => ({ ...user, enrolledBatches: [], isEnrolled: false }));
    }

    const userIds = users.map((u) => u._id);
    const enrollments = await EnrollmentModel.find({
        userId: { $in: userIds },
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    })
        .populate({
            path: 'batchId',
            select: 'title courseId',
            populate: { path: 'courseId', select: 'title' },
        })
        .lean();

    const batchTitlesByUser: Record<string, string[]> = {};
    enrollments.forEach((enr: any) => {
        const uid = enr.userId?.toString?.();
        const batchTitle = enr.batchId?.title;
        const courseTitle = enr.batchId?.courseId?.title;
        const title = courseTitle && batchTitle
            ? `${courseTitle} - ${batchTitle}`
            : (batchTitle || courseTitle || undefined);
        if (!uid || !title) return;
        if (!batchTitlesByUser[uid]) batchTitlesByUser[uid] = [];
        batchTitlesByUser[uid].push(title);
    });

    return users.map((user) => {
        const uid = user._id?.toString?.();
        const batches = Array.from(new Set(batchTitlesByUser[uid] || []));
        return {
            ...user,
            enrolledBatches: batches,
            isEnrolled: batches.length > 0,
        };
    });
};

const getAllUsers = async (params: {
    role?: string;
    status?: string;
    search?: string;
    page?: string | number;
    limit?: string | number;
    batch?: string;
    enrolled?: string;
}) => {
    const {
        role,
        status,
        search,
        page = 1,
        limit = 10,
        batch,
        enrolled,
    } = params;

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 10));
    const query: any = {};

    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
        ];
    }

    let emptyResult = false;
    const globalEnrollmentUserIds: any[] = await EnrollmentModel.distinct('userId', {
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    });

    if (batch || enrolled !== undefined) {
        let batchUserIds: any[] | null = null;

        if (batch) {
            const batchStr = String(batch).trim();
            const escaped = batchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const matched = await BatchModel.find({ title: { $regex: escaped, $options: 'i' } })
                .select('_id')
                .lean();
            let batchIds = (matched || []).map((b: any) => b._id);

            if (batchIds.length === 0) {
                if (/^[0-9a-fA-F]{24}$/.test(batchStr)) {
                    const byId = await BatchModel.findById(batchStr).select('_id').lean();
                    if (byId) batchIds = [byId._id];
                }
            }

            if (batchIds.length === 0) {
                emptyResult = true;
            } else {
                batchUserIds = await EnrollmentModel.distinct('userId', {
                    batchId: { $in: batchIds },
                    status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
                });
            }
        }

        if (batchUserIds) {
            query._id = { $in: batchUserIds };
        }

        if (enrolled === 'true') {
            if (query._id && (query._id as any).$in) {
                const setGlobal = new Set(globalEnrollmentUserIds.map((id: any) => id.toString()));
                const intersect = (query._id as any).$in.filter((id: any) => setGlobal.has(id.toString()));
                query._id = { $in: intersect };
            } else {
                query._id = { $in: globalEnrollmentUserIds };
            }
        } else if (enrolled === 'false') {
            query._id = { $nin: globalEnrollmentUserIds };
        }
    }

    if (emptyResult) {
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

    const skip = (pageNumber - 1) * limitNumber;
    const users = await UserModel.find(query)
        .select('-password')
        .skip(skip)
        .limit(limitNumber)
        .sort({ createdAt: -1 })
        .lean();

    const total = await UserModel.countDocuments(query);
    const usersWithEnrollment = await attachEnrollmentInfo(users);

    return {
        data: usersWithEnrollment,
        meta: {
            total,
            page: pageNumber,
            limit: limitNumber,
            totalPages: Math.ceil(total / limitNumber),
        },
    };
};

const getUserById = async (id: string) => {
    const user = await UserModel.findById(id).select('-password').lean();

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    return user;
};

interface Actor {
    id: string;
    role: string;
}

const createAdmin = async (payload: { name: string; email: string; password: string; role?: string }, actor?: Actor) => {
    const { name, email, password, role } = payload;

    if (!password) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is required when creating a user');
    }

    // Privilege guard: only a superadmin may mint admin/superadmin accounts.
    // A plain admin creating staff is limited to learner/instructor/employee.
    if ((role === Role.ADMIN || role === Role.SUPERADMIN) && actor?.role !== Role.SUPERADMIN) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'Only superadmins can create admin accounts');
    }

    const auth = getAuth();

    let createdUser: any;
    try {
        const result = await auth.api.signUpEmail({
            body: { name, email, password },
            asResponse: false,
        });
        createdUser = result?.user;
    } catch (err: any) {
        const msg = err?.body?.message || err?.message || 'Failed to create user';
        throw new ApiError(StatusCodes.BAD_REQUEST, msg);
    }

    if (!createdUser?.id) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'User creation failed — no user returned from Better Auth');
    }

    const userPayload: Record<string, any> = {
        name,
        email,
        emailVerified: true,
        status: UserStatus.Active,
    };

    if (role) {
        userPayload.role = role;
    }

    // Persist local user metadata for the newly created auth account
    let localUser = await UserModel.findOne({ email }).select('-password').lean();

    if (localUser) {
        localUser = await UserModel.findByIdAndUpdate(
            localUser._id,
            userPayload,
            { new: true, runValidators: true },
        )
            .select('-password')
            .lean();
    } else {
        const createdLocalUser = await UserModel.create(userPayload);
        localUser = await UserModel.findById(createdLocalUser._id).select('-password').lean();
    }

    if (!localUser) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'User creation failed after auth registration');
    }

    return localUser;
};

const revokeUserSessions = async (userId: string) => {
    const db = mongoose.connection.db;
    if (!db) return;

    const objectId = new mongoose.Types.ObjectId(userId);
    await db.collection('sessions').deleteMany({
        userId: { $in: [userId, objectId] },
    });
};

const updateUser = async (id: string, updateData: Record<string, any>, actor?: string | Actor) => {
    const actorId = typeof actor === 'string' ? actor : actor?.id;
    const actorRole = typeof actor === 'string' ? undefined : actor?.role;
    const before = await UserModel.findById(id).select('role status name email').lean();

    if (!before) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    // Mass-assignment guard: only profile fields are editable here. `role`
    // needs superadmin + no self-edit; `status` has its own audited endpoint;
    // `password` must never flow through findByIdAndUpdate (pre-save bcrypt
    // would be skipped → plaintext).
    const { name, email, phone, role } = updateData ?? {};
    const update: Record<string, any> = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (phone !== undefined) update.phone = phone;

    if (role !== undefined && role !== before.role) {
        if (actorRole !== Role.SUPERADMIN) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Only superadmins can change user roles');
        }
        if (actorId && id.toString() === actorId.toString()) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'You cannot change your own role');
        }
        update.role = role;
    }

    const user = await UserModel.findByIdAndUpdate(id, update, {
        new: true,
        runValidators: true,
    })
        .select('-password')
        .lean();

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    if (actorId && update.role && before.role !== update.role) {
        await recordAudit({
            actor: actorId,
            action: 'user.role_change',
            targetType: 'User',
            targetId: id,
            metadata: { from: before.role, to: update.role },
        });
    }

    return user;
};

const updateUserStatus = async (id: string, status: string, actor?: string) => {
    const actorId = typeof actor === 'string' ? actor : (actor as Actor | undefined)?.id;
    // No self-suspend/self-delete: an admin locking their own account is an
    // org lockout with no one left to reverse it.
    if (actorId && id.toString() === actorId.toString() && status !== UserStatus.Active) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'You cannot change your own status');
    }

    const before = await UserModel.findById(id).select('status').lean();

    const user = await UserModel.findByIdAndUpdate(
        id,
        { status },
        { new: true, runValidators: true },
    )
        .select('-password')
        .lean();

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    if (!before || before.status === status) {
        return user;
    }

    // Keep Batch.currentEnrollment (used by topBatches sorting) honest: it
    // counts Active seats, so move them out/in per batch on suspend/delete
    // and reactivate respectively. Counts are always read BEFORE the flip.
    const countActiveByBatch = async (): Promise<Map<string, number>> => {
        const affected = await EnrollmentModel.find({ userId: id, status: EnrollmentStatus.Active })
            .select('batchId')
            .lean();
        const perBatch = new Map<string, number>();
        for (const e of affected) {
            const key = e.batchId?.toString();
            if (key) perBatch.set(key, (perBatch.get(key) ?? 0) + 1);
        }
        return perBatch;
    };
    const countSuspendedByBatch = async (): Promise<Map<string, number>> => {
        const affected = await EnrollmentModel.find({ userId: id, status: EnrollmentStatus.Suspended })
            .select('batchId')
            .lean();
        const perBatch = new Map<string, number>();
        for (const e of affected) {
            const key = e.batchId?.toString();
            if (key) perBatch.set(key, (perBatch.get(key) ?? 0) + 1);
        }
        return perBatch;
    };
    const applyCounterDelta = async (perBatch: Map<string, number>, delta: -1 | 1) => {
        await Promise.all(
            [...perBatch.entries()].map(([batchId, count]) =>
                BatchModel.findByIdAndUpdate(batchId, { $inc: { currentEnrollment: delta * count } })
            )
        );
    };

    if (status === UserStatus.Suspended || status === UserStatus.Deleted) {
        await applyCounterDelta(await countActiveByBatch(), -1);
        await EnrollmentModel.updateMany(
            { userId: id, status: EnrollmentStatus.Active },
            { status: EnrollmentStatus.Suspended },
        );
        await revokeUserSessions(id);
        logger.warn(`Sessions revoked for ${status} user ${user.email}`);
    }

    if (status === UserStatus.Active) {
        const toReactivate = await countSuspendedByBatch();
        await EnrollmentModel.updateMany(
            { userId: id, status: EnrollmentStatus.Suspended },
            { status: EnrollmentStatus.Active },
        );
        await applyCounterDelta(toReactivate, 1);
    }

    await recordAudit({
        actor: actorId,
        action: 'user.status_change',
        targetType: 'User',
        targetId: id,
        metadata: { from: before.status, to: status },
    });

    return user;
};

const deleteUser = async (id: string, actor?: string) => {
    const actorId = typeof actor === 'string' ? actor : (actor as Actor | undefined)?.id;
    if (actorId && id.toString() === actorId.toString()) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'You cannot delete your own account');
    }

    const user = await UserModel.findByIdAndDelete(id);

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    // Cleanup: revoke sessions (requireAuth blocks Deleted, but existing JWE
    // cookie-cache + DB sessions stay valid until expiry otherwise) and drop
    // the profile doc. Enrollments/payments are retained for finance history,
    // but their seats leave the Active counters.
    await revokeUserSessions(id);
    const activeEnrollments = await EnrollmentModel.find({ userId: id, status: EnrollmentStatus.Active })
        .select('batchId')
        .lean();
    const perBatch = new Map<string, number>();
    for (const e of activeEnrollments) {
        const key = (e as any).batchId?.toString();
        if (key) perBatch.set(key, (perBatch.get(key) ?? 0) + 1);
    }
    await Promise.all(
        [...perBatch.entries()].map(([batchId, count]) =>
            BatchModel.findByIdAndUpdate(batchId, { $inc: { currentEnrollment: -count } })
        )
    );
    try {
        const { ProfileModel } = await import('../Profile/profile.model.js');
        await ProfileModel.deleteOne({ user: id });
    } catch (error) {
        logger.error(error, `Failed to delete profile for deleted user ${id}`);
    }

    await recordAudit({
        actor: actorId,
        action: 'user.delete',
        targetType: 'User',
        targetId: id,
        metadata: { email: user.email, role: user.role },
    });
};

const sendEnrollmentReminder = async () => {
    const enrolledUserIds = await EnrollmentModel.distinct('userId', {
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    });

    const nonEnrolledUsers = await UserModel.find({
        _id: { $nin: enrolledUserIds },
        status: UserStatus.Active,
        emailVerified: { $ne: null },
        role: 'learner',
    })
        .select('name email')
        .lean();

    if (nonEnrolledUsers.length > 0) {
        await Promise.all(
            nonEnrolledUsers.map((user: any) => sendEnrollmentReminderEmail(user.email, user.name)),
        );
    }

    return { count: nonEnrolledUsers.length };
};

const sendNewsUpdate = async (subject: string, message: string) => {
    if (!subject || !message) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Subject and message are required');
    }

    const enrolledUserIds = await EnrollmentModel.distinct('userId', {
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    });

    const enrolledUsers = await UserModel.find({
        _id: { $in: enrolledUserIds },
        status: UserStatus.Active,
        emailVerified: { $ne: null },
    })
        .select('name email')
        .lean();

    if (enrolledUsers.length > 0) {
        await Promise.all(
            enrolledUsers.map((user: any) => sendNewsUpdateEmail(user.email, user.name, subject, message)),
        );
    }

    return { count: enrolledUsers.length };
};

const resolveBatchContext = async (courseId: string, batchId: string) => {
    if (!courseId || !batchId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Course ID and Batch ID are required');
    }

    const batch = await BatchModel.findById(batchId)
        .populate({ path: 'courseId', select: 'title slug' })
        .lean();

    if (!batch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
    }

    const course = (batch as any).courseId;
    if (!course?._id) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Course not found for batch');
    }

    if (courseId && course._id.toString() !== courseId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch does not belong to the provided course');
    }

    return { batch, course };
};

const getEnrollmentProgressSnapshot = async (
    enrollmentIds: mongoose.Types.ObjectId[],
    courseId: mongoose.Types.ObjectId,
    batchId: mongoose.Types.ObjectId,
) => {
    const totalModules = await ModuleModel.countDocuments({ courseId, batchId });
    const progressRecords = enrollmentIds.length
        ? await ModuleProgressModel.find(
            { enrollmentId: { $in: enrollmentIds } },
            { enrollmentId: 1, completionPercentage: 1 }
        ).lean()
        : [];

    const completionSumByEnrollment: Record<string, number> = {};
    for (const record of progressRecords as any[]) {
        const key = record.enrollmentId?.toString();
        if (!key) continue;
        completionSumByEnrollment[key] = (completionSumByEnrollment[key] || 0) + (record.completionPercentage || 0);
    }

    return { totalModules, completionSumByEnrollment };
};

const sendRunningBatchProgressReminder = async (courseId: string, batchId: string) => {
    const { batch, course } = await resolveBatchContext(courseId, batchId);

    const now = new Date();
    const isRunning = batch.status === BatchStatus.Running
        || (batch.startDate && batch.endDate && batch.startDate <= now && batch.endDate >= now);

    if (!isRunning) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch is not running');
    }

    const enrollments = await EnrollmentModel.find({
        batchId: batch._id,
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    })
        .populate({ path: 'userId', select: 'name email status emailVerified' })
        .lean();

    const eligibleEnrollments = enrollments.filter((enrollment: any) => {
        const user = enrollment.userId as any;
        return user?.email && user?.status === UserStatus.Active && user?.emailVerified === true;
    });

    if (eligibleEnrollments.length === 0) {
        return { count: 0 };
    }

    const enrollmentIds = eligibleEnrollments.map((enrollment: any) => enrollment._id);
    const { totalModules, completionSumByEnrollment } = await getEnrollmentProgressSnapshot(
        enrollmentIds,
        course._id,
        batch._id,
    );

    const context = { courseName: course.title, courseSlug: course.slug };
    const sendTasks = eligibleEnrollments
        .map((enrollment: any) => {
            const user = enrollment.userId as any;
            const key = enrollment._id?.toString();
            const completionSum = key ? (completionSumByEnrollment[key] || 0) : 0;
            const overallProgress = totalModules > 0
                ? Math.round(completionSum / totalModules)
                : 0;

            if (overallProgress >= 50) {
                return null;
            }

            return sendCourseRunningBatchProgressReminderEmail(
                context,
                user.email,
                user.name || 'Student',
                course.title,
                batch.title,
                overallProgress,
            );
        })
        .filter(Boolean) as Promise<void>[];

    if (sendTasks.length > 0) {
        await Promise.all(sendTasks);
    }

    return { count: sendTasks.length };
};

const sendCompletedBatchIncompleteReminder = async (courseId: string, batchId: string) => {
    const { batch, course } = await resolveBatchContext(courseId, batchId);

    const now = new Date();
    const isCompleted = batch.status === BatchStatus.Completed
        || (batch.endDate && batch.endDate < now);

    if (!isCompleted) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch is not completed yet');
    }

    const enrollments = await EnrollmentModel.find({
        batchId: batch._id,
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    })
        .populate({ path: 'userId', select: 'name email status emailVerified' })
        .lean();

    const eligibleEnrollments = enrollments.filter((enrollment: any) => {
        const user = enrollment.userId as any;
        return user?.email && user?.status === UserStatus.Active && user?.emailVerified === true;
    });

    if (eligibleEnrollments.length === 0) {
        return { count: 0 };
    }

    const enrollmentIds = eligibleEnrollments.map((enrollment: any) => enrollment._id);
    const [progressSnapshot, progressedEnrollmentIds] = await Promise.all([
        getEnrollmentProgressSnapshot(enrollmentIds, course._id, batch._id),
        LessonProgressModel.distinct('enrollmentId', {
            enrollmentId: { $in: enrollmentIds },
            status: { $ne: LessonProgressStatus.NotStarted },
        }),
    ]);

    const progressedSet = new Set((progressedEnrollmentIds as any[]).map((id) => id.toString()));
    const context = { courseName: course.title, courseSlug: course.slug };
    const sendTasks = eligibleEnrollments
        .map((enrollment: any) => {
            const user = enrollment.userId as any;
            const key = enrollment._id?.toString();
            const completionSum = key ? (progressSnapshot.completionSumByEnrollment[key] || 0) : 0;
            const overallProgress = progressSnapshot.totalModules > 0
                ? Math.round(completionSum / progressSnapshot.totalModules)
                : 0;
            const hasProgress = key ? progressedSet.has(key) : false;

            if (overallProgress >= 100 && hasProgress) {
                return null;
            }

            return sendCourseCompletedBatchIncompleteReminderEmail(
                context,
                user.email,
                user.name || 'Student',
                course.title,
                batch.title,
                overallProgress,
            );
        })
        .filter(Boolean) as Promise<void>[];

    if (sendTasks.length > 0) {
        await Promise.all(sendTasks);
    }

    return { count: sendTasks.length };
};

const getAllInstructors = async (opts: { unassignedOnly?: boolean } = {}) => {
    const query: Record<string, any> = { role: 'instructor' };

    if (opts.unassignedOnly) {
        const assignedInstructorIds = await CourseModel.distinct('instructorId', {
            instructorId: { $exists: true, $ne: null },
        });
        query._id = { $nin: assignedInstructorIds };
    }

    return UserModel.find(query)
        .select('_id name email image status createdAt')
        .sort({ name: 1 })
        .lean();
};

const getRoleStats = async () => {
    const counts = await UserModel.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);

    const statusBreakdown = await UserModel.aggregate([
        { $group: { _id: { role: '$role', status: '$status' }, count: { $sum: 1 } } },
    ]);

    const map: Record<string, number> = {};
    counts.forEach((c: any) => { if (c._id) map[c._id] = c.count; });

    const byRoleStatus: Record<string, Record<string, number>> = {};
    statusBreakdown.forEach((c: any) => {
        const role = c._id?.role;
        const status = c._id?.status;
        if (!role || !status) return;
        if (!byRoleStatus[role]) byRoleStatus[role] = {};
        byRoleStatus[role][status] = c.count;
    });

    const total = Object.values(map).reduce((a, b) => a + b, 0);

    const definitions = [
        { role: 'superadmin', label: 'Super Admin', description: 'Full system access, user deletion, audit logs, seeding', color: 'destructive' },
        { role: 'admin', label: 'Admin', description: 'Manage users, courses, batches, payments, certificates, employees, emails', color: 'default' },
        { role: 'instructor', label: 'Instructor', description: 'Assigned courses & batches, lessons/modules, quizzes, recordings', color: 'secondary' },
        { role: 'employee', label: 'Employee', description: 'Self-service: profile/NID, salary, leave requests', color: 'outline' },
        { role: 'learner', label: 'Learner', description: 'Enroll, learn, quizzes, certificates, leaderboard', color: 'outline' },
    ];

    const roles = definitions.map((d) => ({
        ...d,
        count: map[d.role] || 0,
        active: byRoleStatus[d.role]?.['active'] || 0,
        suspended: byRoleStatus[d.role]?.['suspended'] || 0,
    }));

    return { total, roles, byRoleStatus };
};

export const AdminService = {
    login,
    getAllUsers,
    getUserById,
    createAdmin,
    updateUser,
    updateUserStatus,
    deleteUser,
    sendEnrollmentReminder,
    sendNewsUpdate,
    sendRunningBatchProgressReminder,
    sendCompletedBatchIncompleteReminder,
    getAllInstructors,
    getRoleStats,
};
