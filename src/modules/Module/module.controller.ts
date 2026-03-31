import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { ModuleService } from './module.service.js';

/**
 * Create a new module for a course
 */
const createModule = catchAsync(async (req: Request, res: Response) => {
    const { courseId } = req.params as { courseId: string };
    const moduleData = req.body;

    const module = await ModuleService.createModule(courseId, moduleData);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Module created successfully',
        data: module,
    });
});

/**
 * Get all modules for a course
 */
const getCourseModules = catchAsync(async (req: Request, res: Response) => {
    const { courseId } = req.params as { courseId: string };
    const { status } = req.query as { status?: string };

    const modules = await ModuleService.getCourseModules(courseId, status);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Modules retrieved successfully',
        data: modules,
    });
});

/**
 * Get module by ID
 */
const getModuleById = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };

    const module = await ModuleService.getModuleById(moduleId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Module retrieved successfully',
        data: module,
    });
});

/**
 * Update module
 */
const updateModule = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };
    const updateData = req.body;

    const module = await ModuleService.updateModule(moduleId, updateData);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Module updated successfully',
        data: module,
    });
});

/**
 * Delete module
 */
const deleteModule = catchAsync(async (req: Request, res: Response) => {
    const { moduleId } = req.params as { moduleId: string };

    await ModuleService.deleteModule(moduleId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Module deleted successfully',
        data: null,
    });
});

/**
 * Reorder modules
 */
const reorderModules = catchAsync(async (req: Request, res: Response) => {
    const { courseId } = req.params as { courseId: string };
    const { moduleOrders } = req.body;

    const modules = await ModuleService.reorderModules(courseId, moduleOrders);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Modules reordered successfully',
        data: modules,
    });
});

export const ModuleController = {
    createModule,
    getCourseModules,
    getModuleById,
    updateModule,
    deleteModule,
    reorderModules,
};
