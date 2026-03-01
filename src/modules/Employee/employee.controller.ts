import { Request, Response } from 'express';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { EmployeeService } from './employee.service';

/* ─── EMPLOYEE-SIDE CONTROLLERS ─────────────────────────────────────── */

export const getMySalaries = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const result = await EmployeeService.getMySalaries(id, page, limit);
    sendResponse(res, { statusCode: 200, success: true, message: 'Salaries retrieved', data: result });
});

export const getMyLeaveRequests = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const result = await EmployeeService.getMyLeaveRequests(id, page, limit);
    sendResponse(res, { statusCode: 200, success: true, message: 'Leave requests retrieved', data: result });
});

export const addLeaveRequest = catchAsync(async (req: Request, res: Response) => {
    const { id, name } = req.user as any;
    const result = await EmployeeService.addLeaveRequest(id, name, req.body);
    sendResponse(res, { statusCode: 201, success: true, message: 'Leave request submitted', data: result });
});

/* ─── ADMIN-SIDE CONTROLLERS ─────────────────────────────────────────── */

export const getAllEmployees = catchAsync(async (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search as string | undefined;
    const result = await EmployeeService.getAllEmployees(page, limit, search);
    sendResponse(res, { statusCode: 200, success: true, message: 'Employees retrieved', data: result });
});

export const getAllSalaries = catchAsync(async (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const employeeId = req.query.employeeId as string | undefined;
    const status = req.query.status as string | undefined;
    const result = await EmployeeService.getAllSalaries(page, limit, employeeId, status);
    sendResponse(res, { statusCode: 200, success: true, message: 'Salaries retrieved', data: result });
});

export const createSalary = catchAsync(async (req: Request, res: Response) => {
    const result = await EmployeeService.createSalary(req.body);
    sendResponse(res, { statusCode: 201, success: true, message: 'Salary record created', data: result });
});

export const updateSalaryStatus = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const result = await EmployeeService.updateSalaryStatus(id, status);
    sendResponse(res, { statusCode: 200, success: true, message: 'Salary status updated', data: result });
});

export const getAllLeaveRequests = catchAsync(async (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const status = req.query.status as string | undefined;
    const result = await EmployeeService.getAllLeaveRequests(page, limit, status);
    sendResponse(res, { statusCode: 200, success: true, message: 'Leave requests retrieved', data: result });
});

export const updateLeaveStatus = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const result = await EmployeeService.updateLeaveStatus(id, status);
    sendResponse(res, { statusCode: 200, success: true, message: 'Leave status updated', data: result });
});

export const EmployeeController = {
    getMySalaries,
    getMyLeaveRequests,
    addLeaveRequest,
    getAllEmployees,
    getAllSalaries,
    createSalary,
    updateSalaryStatus,
    getAllLeaveRequests,
    updateLeaveStatus,
};
