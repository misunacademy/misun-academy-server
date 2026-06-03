import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiError.js";
import { AdminModel } from "./admin.model.js";
import { UserModel } from "../User/user.model.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import { BatchModel } from "../Batch/batch.model.js";
import { CourseModel } from "../Course/course.model.js";
import { ModuleModel } from "../Module/module.model.js";
import { LessonProgressModel } from "../Progress/lessonProgress.model.js";
import { ModuleProgressModel } from "../Progress/moduleProgress.model.js";
import { BatchStatus, EnrollmentStatus, LessonProgressStatus, UserStatus } from "../../types/common.js";
import { generateToken } from "../../utils/jwt.js";
import { getAuth } from "../../config/betterAuth.js";
import mongoose from "mongoose";
import { sendEnrollmentReminderEmail, sendNewsUpdateEmail } from "../../services/misunAcademyEmails.js";
import { sendCourseCompletedBatchIncompleteReminderEmail, sendCourseRunningBatchProgressReminderEmail } from "../../services/courseEmailRouter.js";

const login = async (email: string, password: string) => {
    const admin = await AdminModel.findOne({ email });

    if (!admin) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Invalid credentials');
    }

    const isPasswordMatch = await admin.comparePassword(password);

    if (!isPasswordMatch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Invalid credentials');
    }

    const token = generateToken({
        id: admin._id as mongoose.Types.ObjectId,
        role: admin.role,
    });

    return {
        token,
        user: {
            name: admin.name,
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

    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;
    const query: any = {};

    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
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

            let matched = await BatchModel.find({ title: { $regex: escaped, $options: 'i' } })
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

const createAdmin = async (payload: { name: string; email: string; password: string; role?: string }) => {
    const { name, email, password, role } = payload;

    if (!password) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is required when creating a user');
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

const updateUser = async (id: string, updateData: Record<string, any>) => {
    const user = await UserModel.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
    })
        .select('-password')
        .lean();

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    return user;
};

const updateUserStatus = async (id: string, status: string) => {
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

    if (status === UserStatus.Suspended) {
        await EnrollmentModel.updateMany(
            { userId: id, status: EnrollmentStatus.Active },
            { status: EnrollmentStatus.Suspended },
        );
    }

    if (status === UserStatus.Active) {
        await EnrollmentModel.updateMany(
            { userId: id, status: EnrollmentStatus.Suspended },
            { status: EnrollmentStatus.Active },
        );
    }

    return user;
};

const deleteUser = async (id: string) => {
    const user = await UserModel.findByIdAndDelete(id);

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }
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
};
