import { Request, Response } from "express";
import catchAsync from "../../utils/catchAsync.js";
import sendResponse from "../../utils/sendResponse.js";
import { DashboardService } from "./dashboard.service.js";

const getDashboardMetaData = catchAsync(async (req: Request, res: Response) => {
    const result = await DashboardService.getDashboardMetaData();
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Metadata Retrive successfully !',
        data: result,
    });
});

const getAdminDashboard = catchAsync(async (req: Request, res: Response) => {
    const result = await DashboardService.getAdminDashboard();
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Admin dashboard data retrieved successfully',
        data: result,
    });
});

const getUserStats = catchAsync(async (req: Request, res: Response) => {
    const result = await DashboardService.getUserStats();
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'User stats retrieved successfully',
        data: result,
    });
});

const getStudentDashboard = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const result = await DashboardService.getStudentDashboard(id);
    sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Student dashboard data retrieved successfully',
        data: result,
    });
});


// const getEmployeeDashboard = catchAsync(async (req: Request, res: Response) => {
//     const { id } = req.user as any;
//     const result = await DashboardService.getEmployeeDashboard(id);
//     sendResponse(res, {
//         statusCode: 200,
//         success: true,
//         message: 'Employee dashboard data retrieved successfully',
//         data: result,
//     });
// });

export const DashboardController = {
    getDashboardMetaData,
    getAdminDashboard,
    getUserStats,
    getStudentDashboard,
    // getEmployeeDashboard,
}
