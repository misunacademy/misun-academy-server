import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync.js";
import { AdminService } from "./admin.service.js";
import sendResponse from "../../utils/sendResponse.js";
import { StatusCodes } from "http-status-codes";

const loginUser = catchAsync(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await AdminService.login(email, password);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'User logged in successfully !',
        data: result,
    });
});

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
    const result = await AdminService.getAllUsers(req.query as any);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Users retrieved successfully',
        data: result.data,
        meta: result.meta,
    });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await AdminService.getUserById(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'User retrieved successfully',
        data: user,
    });
});

const createAdmin = catchAsync(async (req: Request, res: Response) => {
    const createdUser = await AdminService.createAdmin(req.body);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'User created successfully',
        data: createdUser,
    });
});

const updateUser = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await AdminService.updateUser(id, req.body);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'User updated successfully',
        data: user,
    });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const user = await AdminService.updateUserStatus(id, status);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `User ${status} successfully`,
        data: user,
    });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
    await AdminService.deleteUser(req.params.id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'User deleted successfully',
        data: null,
    });
});

const sendEnrollmentReminder = catchAsync(async (_req: Request, res: Response) => {
    const result = await AdminService.sendEnrollmentReminder();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `Enrollment reminder emails queued for ${result.count} users`,
        data: result,
    });
});

const sendNewsUpdate = catchAsync(async (req: Request, res: Response) => {
    const { subject, message } = req.body;
    const result = await AdminService.sendNewsUpdate(subject, message);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `News update emails queued for ${result.count} enrolled students`,
        data: result,
    });
});

const getAllInstructors = catchAsync(async (req: Request, res: Response) => {
    const unassignedOnly = req.query.unassignedOnly === 'true';
    const instructors = await AdminService.getAllInstructors({ unassignedOnly });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Instructors retrieved successfully',
        data: instructors,
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
    getAllInstructors,
};
