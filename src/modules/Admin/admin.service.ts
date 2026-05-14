import { StatusCodes } from "http-status-codes";
import ApiError from "../../errors/ApiError.js";
import { AdminModel } from "./admin.model.js";
import { UserModel } from "../User/user.model.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import { BatchModel } from "../Batch/batch.model.js";
import { CourseModel } from "../Course/course.model.js";
import { EnrollmentStatus, UserStatus } from "../../types/common.js";
import { generateToken } from "../../utils/jwt.js";
import { getAuth } from "../../config/betterAuth.js";
import mongoose from "mongoose";
import { sendEnrollmentReminderEmail, sendNewsUpdateEmail } from "../../services/misunAcademyEmails.js";

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
    getAllInstructors,
};
