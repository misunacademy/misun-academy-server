import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { EmployeeService } from './employee.service.js';

// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/** GET /employee/profile — get my merged profile */
const getMyProfile = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as { id: string };
    const result = await EmployeeService.getMyProfile(id);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Profile retrieved successfully',
        data: result,
    });
});

/** PATCH /employee/profile — update my profile */
const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as { id: string };
    const result = await EmployeeService.updateMyProfile(id, req.body);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Profile updated successfully',
        data: result,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYEE-FACING
// ─────────────────────────────────────────────────────────────────────────────

/** GET /employee/salaries */
const getMySalaries = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as { id: string };
    const result = await EmployeeService.getMySalaries(id, req.query as { page?: number; limit?: number });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Salary records retrieved successfully',
        data: result,
    });
});

/** GET /employee/leave */
const getMyLeaveRequests = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as { id: string };
    const result = await EmployeeService.getMyLeaveRequests(
        id,
        req.query as { page?: number; limit?: number; status?: string }
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Leave requests retrieved successfully',
        data: result,
    });
});

/** POST /employee/leave */
const addLeaveRequest = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as { id: string };
    const { type, from, to, reason } = req.body as {
        type: string; from: string; to: string; reason: string;
    };
    const result = await EmployeeService.addLeaveRequest(
        id,
        { type, from: new Date(from), to: new Date(to), reason } as never
    );
    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Leave request submitted successfully',
        data: result,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN-FACING
// ─────────────────────────────────────────────────────────────────────────────

/** GET /employee/admin/employees */
const getAllEmployees = catchAsync(async (req: Request, res: Response) => {
    const result = await EmployeeService.getAllEmployees(
        req.query as { page?: number; limit?: number; search?: string }
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Employees retrieved successfully',
        data: result,
    });
});

/** GET /employee/admin/salaries */
const getAllSalariesAdmin = catchAsync(async (req: Request, res: Response) => {
    const result = await EmployeeService.getAllSalariesAdmin(
        req.query as { page?: number; limit?: number; employeeId?: string; status?: string }
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Salary records retrieved successfully',
        data: result,
    });
});

/** POST /employee/admin/salaries */
const addSalary = catchAsync(async (req: Request, res: Response) => {
    const result = await EmployeeService.addSalary(req.body);
    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Salary record created successfully',
        data: result,
    });
});

/** PATCH /employee/admin/salaries/:id/status */
const updateSalaryStatus = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: 'Paid' | 'Pending' };
    const result = await EmployeeService.updateSalaryStatus(id, status);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Salary status updated successfully',
        data: result,
    });
});

/** GET /employee/admin/leave */
const getAllLeaveRequestsAdmin = catchAsync(async (req: Request, res: Response) => {
    const result = await EmployeeService.getAllLeaveRequestsAdmin(
        req.query as { page?: number; limit?: number; status?: string }
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Leave requests retrieved successfully',
        data: result,
    });
});

/** PATCH /employee/admin/leave/:id/status */
const updateLeaveStatus = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: 'Approved' | 'Rejected' };
    const result = await EmployeeService.updateLeaveStatus(id, status);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: `Leave request ${status.toLowerCase()} successfully`,
        data: result,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
export const EmployeeController = {
    // Profile
    getMyProfile,
    updateMyProfile,
    // Employee-facing
    getMySalaries,
    getMyLeaveRequests,
    addLeaveRequest,
    // Admin-facing
    getAllEmployees,
    getAllSalariesAdmin,
    addSalary,
    updateSalaryStatus,
    getAllLeaveRequestsAdmin,
    updateLeaveStatus,
};
