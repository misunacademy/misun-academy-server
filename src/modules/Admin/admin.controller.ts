import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync.js";
import { AdminAuthService } from "./admin.service.js";
import sendResponse from "../../utils/sendResponse.js";
import { UserModel } from "../User/user.model.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import { BatchModel } from "../Batch/batch.model.js";
import { EnrollmentStatus, UserStatus } from "../../types/common.js";
import ApiError from "../../errors/ApiError.js";
import { StatusCodes } from "http-status-codes";
import { sendEnrollmentReminderEmail, sendNewsUpdateEmail } from "../../services/emailService.js";

const loginUser = catchAsync(async (req: Request, res: Response) => {
    const email = req.body.email;
    const password = req.body.password;
    const result = await AdminAuthService.login(email, password);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User logged in successfully !',
        data: result,
    });
});

/**
 * Get all users with filters
 * GET /api/v1/admin/users
 */
const getAllUsers = catchAsync(async (req: Request, res: Response) => {
    const { role, status, search, page = 1, limit = 10, batch, enrolled } = req.query;

    const query: any = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }

    // Batch and enrolled filters should be independent:
    // - `batch` filters users who are enrolled in batches matching the title
    // - `enrolled` filters users who have any active/completed enrollments (global)
    if (batch || enrolled !== undefined) {
        // global enrolled user ids (any batch)
        const globalEnrollmentUserIds: any[] = await EnrollmentModel.distinct('userId', {
            status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] }
        });

        let batchUserIds: any[] | null = null;
        if (batch) {
            const batchStr = String(batch).trim();
            const escaped = batchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            let matched = await BatchModel.find({ title: { $regex: escaped, $options: 'i' } }).select('_id').lean();
            let batchIds = (matched || []).map((b: any) => b._id);

            // If no match by title, try interpreting input as an ObjectId
            if (batchIds.length === 0) {
                if (/^[0-9a-fA-F]{24}$/.test(batchStr)) {
                    const byId = await BatchModel.findById(batchStr).select('_id').lean();
                    if (byId) batchIds = [byId._id];
                }
            }

            if (batchIds.length === 0) {
                // No matching batches -> return empty paginated response
                return sendResponse(res, {
                    statusCode: 200,
                    success: true,
                    message: 'Users retrieved successfully',
                    data: [],
                    meta: {
                        total: 0,
                        page: Number(page),
                        limit: Number(limit),
                        totalPages: 0,
                    },
                });
            }

            // users enrolled in the matched batch(es)
            batchUserIds = await EnrollmentModel.distinct('userId', {
                batchId: { $in: batchIds },
                status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] }
            });
        }

        // Apply filters independently and combine logically (AND)
        if (batchUserIds) {
            // If both batch and enrolled=true, intersection is fine (batchUserIds is subset of global)
            query._id = { $in: batchUserIds };
        }

        if (enrolled === 'true') {
            if (query._id && (query._id as any).$in) {
                // intersect existing $in with globalEnrollmentUserIds
                const setGlobal = new Set(globalEnrollmentUserIds.map((id: any) => id.toString()));
                const intersect = (query._id as any).$in.filter((id: any) => setGlobal.has(id.toString()));
                query._id = { $in: intersect };
            } else {
                query._id = { $in: globalEnrollmentUserIds };
            }
        } else if (enrolled === 'false') {
            // users not enrolled anywhere
            query._id = { $nin: globalEnrollmentUserIds };
        }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const users = await UserModel.find(query)
        .select('-password')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 })
        .lean();
    const total = await UserModel.countDocuments(query);

    // Compute enrollment info for returned users (active or completed enrollments)
    const userIds = users.map((u: any) => u._id);
    const enrollments = userIds.length > 0 ? await EnrollmentModel.find({
        userId: { $in: userIds },
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] }
    }).populate({ path: 'batchId', select: 'title' }).lean() : [];

    // Map userId -> array of batch titles
    const batchTitlesByUser: Record<string, string[]> = {};
    enrollments.forEach((enr: any) => {
        const uid = enr.userId?.toString?.();
        const title = enr.batchId?.title;
        if (!uid) return;
        if (!batchTitlesByUser[uid]) batchTitlesByUser[uid] = [];
        if (title) batchTitlesByUser[uid].push(title);
    });

    const usersWithEnrollment = users.map((u: any) => {
        const obj = u as any;
        const batches = batchTitlesByUser[obj._id?.toString?.()] || [];
        obj.enrolledBatches = batches;
        // keep isEnrolled for backward compatibility
        obj.isEnrolled = batches.length > 0;
        return obj;
    });
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Users retrieved successfully',
        data: usersWithEnrollment,
        meta: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit)),
        },
    });
});

/**
 * Get user by ID
 * GET /api/v1/admin/users/:id
 */
const getUserById = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await UserModel.findById(id).select('-password');

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User retrieved successfully',
        data: user,
    });
});

/**
 * Create admin user (SuperAdmin only)
 * POST /api/v1/admin/users
 */
const createAdmin = catchAsync(async (req: Request, res: Response) => {
    const adminData = req.body;
    const user = await UserModel.create(adminData);

    sendResponse(res, {
        statusCode: 201,
        success: true,
        message: 'Admin created successfully',
        data: user,
    });
});

/**
 * Update user
 * PUT /api/v1/admin/users/:id
 */
const updateUser = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    const user = await UserModel.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User updated successfully',
        data: user,
    });
});

/**
 * Update user status (suspend/activate)
 * PATCH /api/v1/admin/users/:id/status
 * When suspending, also suspends all active enrollments
 */
const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    const user = await UserModel.findByIdAndUpdate(
        id,
        { status },
        { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    // If suspending user, also suspend all active enrollments
    if (status === UserStatus.Suspended) {
        await EnrollmentModel.updateMany(
            { userId: id, status: EnrollmentStatus.Active },
            { status: EnrollmentStatus.Suspended }
        );
    }

    // If activating user, reactivate enrollments (admin can manually adjust if needed)
    if (status === UserStatus.Active) {
        await EnrollmentModel.updateMany(
            { userId: id, status: EnrollmentStatus.Suspended },
            { status: EnrollmentStatus.Active }
        );
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `User ${status} successfully`,
        data: user,
    });
});

/**
 * Delete user
 * DELETE /api/v1/admin/users/:id
 */
const deleteUser = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await UserModel.findByIdAndDelete(id);

    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User deleted successfully',
        data: null,
    });
});

/**
 * Send enrollment reminder to registered but not enrolled users
 * POST /api/v1/admin/send-enrollment-reminder
 */
const sendEnrollmentReminder = catchAsync(async (req: Request, res: Response) => {
    // Find users who are registered but not enrolled in any active/completed course
    const enrolledUserIds = await EnrollmentModel.distinct('userId', {
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] }
    });

    const nonEnrolledUsers = await UserModel.find({
        _id: { $nin: enrolledUserIds },
        status: UserStatus.Active,
        emailVerified: { $ne: null }, // Only send to verified emails
        role: 'learner' // Only send to learners, not admins
    }).select('name email').lean();

    if (nonEnrolledUsers.length === 0) {
        return sendResponse(res, {
            statusCode: 200,
            success: true,
            message: 'No non-enrolled users found',
            data: { count: 0 },
        });
    }

    // Queue emails for all non-enrolled users
    const emailPromises = nonEnrolledUsers.map((user: any) =>
        sendEnrollmentReminderEmail(user.email, user.name)
    );

    await Promise.all(emailPromises);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `Enrollment reminder emails queued for ${nonEnrolledUsers.length} users`,
        data: { count: nonEnrolledUsers.length },
    });
});

/**
 * Send news and updates to all enrolled students
 * POST /api/v1/admin/send-news-update
 * Body: { subject: string, message: string }
 */
const sendNewsUpdate = catchAsync(async (req: Request, res: Response) => {
    const { subject, message } = req.body;

    if (!subject || !message) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Subject and message are required');
    }

    // Find all users with active or completed enrollments
    const enrolledUserIds = await EnrollmentModel.distinct('userId', {
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] }
    });

    const enrolledUsers = await UserModel.find({
        _id: { $in: enrolledUserIds },
        status: UserStatus.Active,
        emailVerified: { $ne: null } // Only send to verified emails
    }).select('name email').lean();

    if (enrolledUsers.length === 0) {
        return sendResponse(res, {
            statusCode: 200,
            success: true,
            message: 'No enrolled users found',
            data: { count: 0 },
        });
    }

    // Queue emails for all enrolled users
    const emailPromises = enrolledUsers.map((user: any) =>
        sendNewsUpdateEmail(user.email, user.name, subject, message)
    );

    await Promise.all(emailPromises);

    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: `News update emails queued for ${enrolledUsers.length} enrolled students`,
        data: { count: enrolledUsers.length },
    });
});

export const AdminAuthController = {
    loginUser,
    getAllUsers,
    getUserById,
    createAdmin,
    updateUser,
    updateUserStatus,
    deleteUser,
    sendEnrollmentReminder,
    sendNewsUpdate,
};
