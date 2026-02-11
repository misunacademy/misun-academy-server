import { StatusCodes } from 'http-status-codes';
import { ModuleModel } from './module.model';
import { LessonModel } from '../Lesson/lesson.model';
import ApiError from '../../errors/ApiError';

/**
 * Create a new module for a course
 */
const createModule = async (courseId: string, moduleData: any) => {
    // Check if order index exists
    if (moduleData.orderIndex !== undefined) {
        const existingModule = await ModuleModel.findOne({
            courseId,
            orderIndex: moduleData.orderIndex,
        });

        if (existingModule) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Module with this order index already exists'
            );
        }
    } else {
        // Auto-assign order index
        const maxOrder = await ModuleModel.findOne({ courseId }).sort({ orderIndex: -1 });
        moduleData.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    const module = await ModuleModel.create({
        ...moduleData,
        courseId,
    });

    return module;
};

/**
 * Get all modules for a course
 */
const getCourseModules = async (courseId: string, status?: string) => {
    const query: any = { courseId };
    if (status) query.status = status;

    const modules = await ModuleModel.find(query).sort({ orderIndex: 1 });

    // Get lesson count for each module
    const modulesWithLessonCount = await Promise.all(
        modules.map(async (module) => {
            const lessonCount = await LessonModel.countDocuments({ moduleId: module._id });
            return {
                ...module.toObject(),
                lessonCount,
            };
        })
    );

    return modulesWithLessonCount;
};

/**
 * Get module by ID
 */
const getModuleById = async (moduleId: string) => {
    const module = await ModuleModel.findById(moduleId);

    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }

    const lessonCount = await LessonModel.countDocuments({ moduleId: module._id });

    return {
        ...module.toObject(),
        lessonCount,
    };
};

/**
 * Update module
 */
const updateModule = async (moduleId: string, updateData: any) => {
    const module = await ModuleModel.findById(moduleId);

    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }

    // Check order index conflict
    if (updateData.orderIndex !== undefined && updateData.orderIndex !== module.orderIndex) {
        const existingModule = await ModuleModel.findOne({
            courseId: module.courseId,
            orderIndex: updateData.orderIndex,
            _id: { $ne: moduleId },
        });

        if (existingModule) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Module with this order index already exists'
            );
        }
    }

    Object.assign(module, updateData);
    await module.save();

    return module;
};

/**
 * Delete module
 */
const deleteModule = async (moduleId: string) => {
    const module = await ModuleModel.findById(moduleId);

    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }

    // Check if module has lessons
    const lessonCount = await LessonModel.countDocuments({ moduleId });

    if (lessonCount > 0) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Cannot delete module with existing lessons. Delete lessons first.'
        );
    }

    await ModuleModel.findByIdAndDelete(moduleId);
    return null;
};

/**
 * Reorder modules
 */
const reorderModules = async (courseId: string, moduleOrders: { moduleId: string; orderIndex: number }[]) => {
    if (!Array.isArray(moduleOrders)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'moduleOrders must be an array');
    }

    // Update order indexes
    await Promise.all(
        moduleOrders.map(({ moduleId, orderIndex }) =>
            ModuleModel.findByIdAndUpdate(moduleId, { orderIndex })
        )
    );

    const modules = await ModuleModel.find({ courseId }).sort({ orderIndex: 1 });
    return modules;
};

export const ModuleService = {
    createModule,
    getCourseModules,
    getModuleById,
    updateModule,
    deleteModule,
    reorderModules,
};
