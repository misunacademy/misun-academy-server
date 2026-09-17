import { StatusCodes } from 'http-status-codes';
import { LessonModel } from './lesson.model.js';
import { ModuleModel } from '../Module/module.model.js';
import ApiError from '../../errors/ApiError.js';
import { normalizeVideoId } from '../../utils/video.utils.js';
import { NotificationService } from '../Notification/notification.service.js';
import { logger } from '../../config/logger.js';

const sendPublishNotification = (lesson: any): void => {
    setImmediate(async () => {
        try {
            const module = await ModuleModel.findById(lesson.moduleId).lean();
            if (module?.batchId) {
                await NotificationService.createBatchNotification(
                    module.batchId.toString(),
                    {
                        type: 'lesson_published',
                        title: 'New Lesson Available',
                        message: `New lesson "${lesson.title}" has been published`,
                        link: '/my-classes',
                    }
                );
            }
        } catch (error) {
            logger.error(error, 'Failed to send lesson notification');
        }
    });
};

/**
 * Create a new lesson for a module
 */
const createLesson = async (moduleId: string, lessonData: any) => {
    const module = await ModuleModel.findById(moduleId).lean();
    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }

    if (lessonData.orderIndex !== undefined) {
        const existingLesson = await LessonModel.findOne({
            moduleId,
            orderIndex: lessonData.orderIndex,
        }).lean();

        if (existingLesson) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Lesson with this order index already exists'
            );
        }
    } else {
        const maxOrder = await LessonModel.findOne({ moduleId }).sort({ orderIndex: -1 }).lean();
        lessonData.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    if (lessonData.videoId) {
        lessonData.videoId = normalizeVideoId(lessonData.videoSource, lessonData.videoId);
        // Drop stale embed URLs built from a previously-wrapped id.
        delete lessonData.videoUrl;
    }

    const lesson = await LessonModel.create({
        ...lessonData,
        moduleId,
    });

    if (lesson.isPublished) {
        sendPublishNotification(lesson);
    }

    return lesson;
};

/**
 * Get all lessons for a module
 */
const getModuleLessons = async (moduleId: string, type?: string) => {
    const query: any = { moduleId };
    if (type) query.type = type;

    const lessons = await LessonModel.find(query).sort({ orderIndex: 1 }).lean();
    return lessons;
};

/**
 * Get lesson by ID
 */
const getLessonById = async (lessonId: string) => {
    const lesson = await LessonModel.findById(lessonId).populate('moduleId').lean();

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    return lesson;
};

/**
 * Update lesson
 */
const updateLesson = async (lessonId: string, updateData: any) => {
    const oldLesson = await LessonModel.findById(lessonId).lean();

    if (!oldLesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    if (updateData.orderIndex !== undefined && updateData.orderIndex !== oldLesson.orderIndex) {
        const existingLesson = await LessonModel.findOne({
            moduleId: oldLesson.moduleId,
            orderIndex: updateData.orderIndex,
            _id: { $ne: lessonId },
        }).lean();

        if (existingLesson) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Lesson with this order index already exists'
            );
        }
    }

    if (updateData.videoId) {
        updateData.videoId = normalizeVideoId(updateData.videoSource ?? (oldLesson as any).videoSource, updateData.videoId);
        delete updateData.videoUrl;
    }

    const lesson = await LessonModel.findByIdAndUpdate(
        lessonId,
        { $set: updateData },
        { new: true, runValidators: true }
    );

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    if (!oldLesson.isPublished && lesson.isPublished) {
        sendPublishNotification(lesson);
    }

    return lesson;
};

/**
 * Delete lesson
 */
const deleteLesson = async (lessonId: string) => {
    const lesson = await LessonModel.findById(lessonId).lean();

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    await LessonModel.findByIdAndDelete(lessonId);
    return null;
};

/**
 * Backfill existing rows created before input normalization: strip full
 * URLs / double-wrapped values down to raw ids and drop stale videoUrls.
 * Returns the number of lessons repaired.
 */
const backfillVideoIds = async (): Promise<number> => {
    const lessons = await LessonModel.find({ videoId: { $exists: true, $ne: '' } }).lean();
    let fixed = 0;
    for (const lesson of lessons) {
        const raw = (lesson as any).videoId;
        if (typeof raw !== 'string' || !raw) continue;
        const normalized = normalizeVideoId((lesson as any).videoSource, raw);
        if (normalized && normalized !== raw) {
            await LessonModel.findByIdAndUpdate((lesson as any)._id, {
                $set: { videoId: normalized },
                $unset: { videoUrl: '' },
            });
            fixed++;
        }
    }
    return fixed;
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

    const lessons = await LessonModel.find({ moduleId }).sort({ orderIndex: 1 }).lean();
    return lessons;
};

export const LessonService = {
    createLesson,
    getModuleLessons,
    getLessonById,
    updateLesson,
    deleteLesson,
    reorderLessons,
    backfillVideoIds,
};
