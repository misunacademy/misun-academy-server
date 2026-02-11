import { StatusCodes } from 'http-status-codes';
import { LessonModel } from './lesson.model';
import { ModuleModel } from '../Module/module.model';
import ApiError from '../../errors/ApiError';

/**
 * Create a new lesson for a module
 */
const createLesson = async (moduleId: string, lessonData: any) => {
    // Verify module exists
    const module = await ModuleModel.findById(moduleId);
    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }

    // Check if order index exists
    if (lessonData.orderIndex !== undefined) {
        const existingLesson = await LessonModel.findOne({
            moduleId,
            orderIndex: lessonData.orderIndex,
        });

        if (existingLesson) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Lesson with this order index already exists'
            );
        }
    } else {
        // Auto-assign order index
        const maxOrder = await LessonModel.findOne({ moduleId }).sort({ orderIndex: -1 });
        lessonData.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    const lesson = await LessonModel.create({
        ...lessonData,
        moduleId,
    });

    return lesson;
};

/**
 * Get all lessons for a module
 */
const getModuleLessons = async (moduleId: string, type?: string) => {
    const query: any = { moduleId };
    if (type) query.type = type;

    const lessons = await LessonModel.find(query).sort({ orderIndex: 1 });
    return lessons;
};

/**
 * Get lesson by ID
 */
const getLessonById = async (lessonId: string) => {
    const lesson = await LessonModel.findById(lessonId).populate('moduleId');

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    return lesson;
};

/**
 * Update lesson
 */
const updateLesson = async (lessonId: string, updateData: any) => {
    const lesson = await LessonModel.findById(lessonId);

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    // Check order index conflict
    if (updateData.orderIndex !== undefined && updateData.orderIndex !== lesson.orderIndex) {
        const existingLesson = await LessonModel.findOne({
            moduleId: lesson.moduleId,
            orderIndex: updateData.orderIndex,
            _id: { $ne: lessonId },
        });

        if (existingLesson) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Lesson with this order index already exists'
            );
        }
    }

    Object.assign(lesson, updateData);
    await lesson.save();

    return lesson;
};

/**
 * Delete lesson
 */
const deleteLesson = async (lessonId: string) => {
    const lesson = await LessonModel.findById(lessonId);

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    await LessonModel.findByIdAndDelete(lessonId);
    return null;
};

/**
 * Reorder lessons in a module
 */
const reorderLessons = async (moduleId: string, lessonOrders: { lessonId: string; orderIndex: number }[]) => {
    if (!Array.isArray(lessonOrders)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'lessonOrders must be an array');
    }

    // Update order indexes
    await Promise.all(
        lessonOrders.map(({ lessonId, orderIndex }) =>
            LessonModel.findByIdAndUpdate(lessonId, { orderIndex })
        )
    );

    const lessons = await LessonModel.find({ moduleId }).sort({ orderIndex: 1 });
    return lessons;
};

export const LessonService = {
    createLesson,
    getModuleLessons,
    getLessonById,
    updateLesson,
    deleteLesson,
    reorderLessons,
};
