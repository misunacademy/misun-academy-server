import mongoose, { FilterQuery, Types } from 'mongoose';
import { CourseModel } from './course.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { EnrollmentStatus } from '../../types/common.js';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { QuizModel } from '../Quiz/quiz.model.js';
import { UserModel } from '../User/user.model.js';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { buildDrivePreviewUrl, buildYouTubeWatchUrl, normalizeVideoId } from '../../utils/video.utils.js';
import { NotificationService } from '../Notification/notification.service.js';
import { logger } from '../../config/logger.js';

export const CourseService = {
    async createCourse(data: any) {
        // Generate slug from title if not provided
        if (!data.slug && data.title) {
            data.slug = data.title
                .toString()
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-');
        }
        const course = await CourseModel.create(data);
        return course;
    },

    async getCourses(filter: FilterQuery<any> = {}, opts: { page?: number; perPage?: number } = {}) {
        const page = opts.page || 1;
        const perPage = opts.perPage || 20;
        const [data, total] = await Promise.all([
            CourseModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean(),
            CourseModel.countDocuments(filter),
        ]);

        // Batch student count lookup to avoid N+1. Enrollments reference
        // batches (not courses), so join through the batch's courseId.
        const courseIds = data.map((c) => c._id);
        const counts = courseIds.length > 0
            ? await EnrollmentModel.aggregate([
                { $match: { status: { $ne: 'cancelled' } } },
                {
                    $lookup: {
                        from: 'batches',
                        localField: 'batchId',
                        foreignField: '_id',
                        as: 'batch',
                    },
                },
                { $unwind: '$batch' },
                { $match: { 'batch.courseId': { $in: courseIds } } },
                { $group: { _id: '$batch.courseId', count: { $sum: 1 } } },
            ])
            : [];
        const countByCourseId: Record<string, number> = {};
        for (const entry of counts) {
            countByCourseId[entry._id.toString()] = entry.count;
        }
        const coursesWithCount = data.map((course) => ({
            ...course,
            studentsCount: countByCourseId[course._id.toString()] || 0,
        }));

        return { data: coursesWithCount, meta: { page, limit: perPage, total, totalPages: Math.ceil(total / perPage) } };
    },

    async getCourseById(id: string, opts: { batchId?: string; includeContent?: boolean } = {}) {
        const course = await CourseModel.findById(id)
            .populate('instructorId', 'name email image')
            .lean();

        if (!course) return null;


        const moduleQuery: Record<string, unknown> = { courseId: id };
        if (opts.batchId) moduleQuery.batchId = opts.batchId;

        const modules = await ModuleModel.find(moduleQuery).sort({ orderIndex: 1 }).lean();

        // Public storefront must never receive watchable content: lessons are
        // filtered to published and stripped to syllabus metadata unless the
        // caller explicitly opts into full content (gated classroom paths).
        // Batch the per-module lesson/quiz reads into two grouped queries
        // instead of N×2 round trips.
        const moduleIds = modules.map((m: any) => m._id);
        const [allLessons, allQuizzes] = await Promise.all([
            moduleIds.length
                ? LessonModel.find({ moduleId: { $in: moduleIds }, ...(opts.includeContent ? {} : { isPublished: true }) })
                    .sort({ orderIndex: 1 }).lean()
                : [],
            moduleIds.length
                ? QuizModel.find({ moduleId: { $in: moduleIds }, status: 'published' }).sort({ orderIndex: 1 }).lean()
                : [],
        ]);
        const lessonsByModule = new Map<string, any[]>();
        for (const lesson of allLessons) {
            const key = (lesson as any).moduleId?.toString();
            if (!lessonsByModule.has(key)) lessonsByModule.set(key, []);
            lessonsByModule.get(key)!.push(lesson);
        }
        const quizzesByModule = new Map<string, any[]>();
        for (const quiz of allQuizzes) {
            const key = (quiz as any).moduleId?.toString();
            if (!quizzesByModule.has(key)) quizzesByModule.set(key, []);
            quizzesByModule.get(key)!.push(quiz);
        }

        // Fetch lessons and quizzes for each module
        const curriculum = modules.map((module: any) => {
                const lessons = lessonsByModule.get(module._id.toString()) ?? [];
                const quizzes = quizzesByModule.get(module._id.toString()) ?? [];

                return {
                    moduleId: module._id.toString(),
                    title: module.title,
                    description: module.description,
                    order: module.orderIndex,
                    lessons: lessons.map((lesson: any) => {
                        // Construct video URL if not present but videoId exists.
                        // Normalize first: older rows may hold a full pasted URL
                        // (or a double-wrapped watch?v=<url>) in videoId.
                        const rawVideoId = typeof lesson.videoId === 'string' ? lesson.videoId : '';
                        const videoId = rawVideoId ? normalizeVideoId(lesson.videoSource, rawVideoId) : '';
                        let videoUrl = lesson.videoUrl;

                        if (!videoUrl && videoId && lesson.videoSource) {
                            if (lesson.videoSource === 'youtube') {
                                videoUrl = buildYouTubeWatchUrl(videoId);
                            } else if (lesson.videoSource === 'googledrive') {
                                videoUrl = buildDrivePreviewUrl(videoId);
                            }
                        } else if (videoUrl && lesson.videoSource === 'googledrive' && videoUrl.includes('/view')) {
                            // `/view` does not embed in an iframe — serve `/preview`.
                            const driveId = videoId || normalizeVideoId('googledrive', videoUrl);
                            if (driveId) videoUrl = buildDrivePreviewUrl(driveId);
                        }

                        const base = {
                            lessonId: lesson._id.toString(),
                            title: lesson.title,
                            description: lesson.description,
                            duration: lesson.videoDuration,
                            order: lesson.orderIndex,
                            type: lesson.type,
                            isMandatory: lesson.isMandatory,
                        };
                        if (!opts.includeContent) return base;
                        return {
                            ...base,
                            media: videoUrl ? {
                                url: videoUrl,
                                type: lesson.videoSource || 'youtube',
                                videoId: videoId || lesson.videoId,
                            } : null,
                            content: lesson.content,
                            resources: lesson.resources || [],
                        };
                    }),
                    quizzes: quizzes.map((quiz: any) => ({
                        quizId: quiz._id.toString(),
                        title: quiz.title,
                        timeLimit: quiz.timeLimit,
                        totalQuestions: quiz.totalQuestions,
                        totalMarks: quiz.totalMarks,
                        passingPercentage: quiz.passingPercentage,
                        orderIndex: quiz.orderIndex,
                    })),
                };
            })
        ;

        return {
            ...course,
            curriculum,
        };
    },

    async getCourseBySlug(slug: string) {
        // Public storefront: drafts must not be enumerable via slug.
        return await CourseModel.findOne({ slug, status: 'published' }).lean();
    },

    /**
     * Classroom assembly: same as getCourseById but WITH watchable content,
     * gated on an Active/Completed enrollment of the caller. Unenrolled
     * callers get 403 — the public getCourseById (syllabus-only) is the
     * storefront path.
     */
    async getClassroomCourse(userId: string, courseIdOrSlug: string, batchId?: string) {
        const course = mongoose.isValidObjectId(courseIdOrSlug)
            ? await CourseModel.findById(courseIdOrSlug).select('_id').lean()
            : await CourseModel.findOne({ slug: courseIdOrSlug }).select('_id').lean();
        if (!course) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Course not found');
        }
        const courseId = (course._id as Types.ObjectId).toString();

        let enrollment;
        if (batchId) {
            if (!mongoose.isValidObjectId(batchId)) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid batch ID');
            }
            enrollment = await EnrollmentModel.findOne({
                userId,
                batchId,
                status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
            }).lean();
        } else {
            const batchIds = await BatchModel.find({ courseId }).distinct('_id');
            enrollment = batchIds.length
                ? await EnrollmentModel.findOne({
                    userId,
                    batchId: { $in: batchIds },
                    status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
                }).lean()
                : null;
        }
        if (!enrollment) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'You are not enrolled in this course');
        }

        return this.getCourseById(courseId, {
            batchId: (enrollment.batchId as Types.ObjectId).toString(),
            includeContent: true,
        });
    },

    async updateCourse(id: string, data: any) {
        const oldCourse = await CourseModel.findById(id).lean();
        // Slugs are immutable (links + brand derivation depend on them);
        // runValidators keeps enum/casing honest on updates.
        const { slug: _droppedSlug, ...safeData } = data ?? {};
        const updated = await CourseModel.findByIdAndUpdate(id, safeData, { new: true, runValidators: true });

        if (updated && oldCourse && oldCourse.status !== 'published' && updated.status === 'published') {
            setImmediate(async () => {
                try {
                    await NotificationService.createNotificationForAdmins({
                        type: 'course_published',
                        title: 'Course Published',
                        message: `Course "${updated.title}" has been published`,
                        link: '/dashboard/admin/courses',
                        relatedTo: { model: 'Course', id: updated._id.toString() },
                    });

                    const instructors = await UserModel.find({
                        role: 'instructor',
                        status: 'active',
                    }).select('_id').lean();

                    for (const instructor of instructors) {
                        await NotificationService.createNotification({
                            userId: instructor._id.toString(),
                            type: 'course_published',
                            title: 'New Course Published',
                            message: `Course "${updated.title}" is now available for teaching`,
                            link: '/dashboard/instructor/courses',
                            relatedTo: { model: 'Course', id: updated._id.toString() },
                        });
                    }
                } catch (error) {
                    logger.error(error, 'Failed to send course published notification');
                }
            });
        }

        return updated;
    },

    async deleteCourse(id: string) {
        // Hard delete orphans batches/modules/lessons/enrollments. Refuse
        // while dependents exist — archive the course instead.
        const batchCount = await BatchModel.countDocuments({ courseId: id });
        if (batchCount > 0) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Cannot delete a course with batches. Archive it or delete its batches first.'
            );
        }
        const moduleCount = await ModuleModel.countDocuments({ courseId: id });
        if (moduleCount > 0) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'Cannot delete a course with modules. Archive it or delete its modules first.'
            );
        }
        return await CourseModel.findByIdAndDelete(id);
    },

    async addModule(courseId: string, module: any) {
        return await CourseModel.findByIdAndUpdate(courseId, { $push: { curriculum: module } }, { new: true });
    },

    async updateModule(courseId: string, moduleId: string, moduleData: any) {
        return await CourseModel.findOneAndUpdate({ _id: courseId, 'curriculum.moduleId': moduleId }, { $set: { 'curriculum.$': moduleData } }, { new: true });
    },

    async removeModule(courseId: string, moduleId: string) {
        return await CourseModel.findByIdAndUpdate(courseId, { $pull: { curriculum: { moduleId } } }, { new: true });
    },

    /**
     * Assign one instructor to a course (replaces any existing).
     * instructorId must be a User._id with role=instructor. Pass null to unassign.
     */
    async assignInstructor(courseId: string, instructorId: string | null) {
        if (instructorId) {
            // Validate that the user exists and has instructor role
            const user = await UserModel.findOne({ _id: instructorId, role: 'instructor' }).lean();
            if (!user) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'User not found or does not have instructor role');
            }
        }

        const oldCourse = await CourseModel.findById(courseId).lean();
        const course = await CourseModel.findByIdAndUpdate(
            courseId,
            { instructorId: instructorId ? new Types.ObjectId(instructorId) : null },
            { new: true }
        ).populate('instructorId', 'name email image');

        if (!course) throw new ApiError(StatusCodes.NOT_FOUND, 'Course not found');

        if (instructorId && (!oldCourse?.instructorId || oldCourse.instructorId.toString() !== instructorId)) {
            setImmediate(async () => {
                try {
                    await NotificationService.createNotification({
                        userId: instructorId,
                        type: 'instructor_assigned',
                        title: 'Course Assignment',
                        message: `You have been assigned as instructor for "${course.title}"`,
                        link: `/dashboard/instructor/courses/${course._id}`,
                        relatedTo: { model: 'Course', id: course._id.toString() },
                    });
                } catch (error) {
                    logger.error(error, 'Failed to send instructor assigned notification');
                }
            });
        }

        return course;
    },
};

