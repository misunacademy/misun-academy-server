import { FilterQuery, Types } from 'mongoose';
import { CourseModel } from './course.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { QuizModel } from '../Quiz/quiz.model.js';
import { UserModel } from '../User/user.model.js';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
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

        // Batch student count lookup to avoid N+1
        const courseIds = data.map((c) => c._id);
        const counts = courseIds.length > 0
            ? await EnrollmentModel.aggregate([
                { $match: { course: { $in: courseIds }, status: { $ne: 'cancelled' } } },
                { $group: { _id: '$course', count: { $sum: 1 } } },
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

    async getCourseById(id: string, opts: { batchId?: string } = {}) {
        const course = await CourseModel.findById(id)
            .populate('instructorId', 'name email image')
            .lean();
        
        if (!course) return null;

        
        const moduleQuery: Record<string, unknown> = { courseId: id };
        if (opts.batchId) moduleQuery.batchId = opts.batchId;

        const modules = await ModuleModel.find(moduleQuery).sort({ orderIndex: 1 }).lean();
        
        // Fetch lessons and quizzes for each module
        const curriculum = await Promise.all(
            modules.map(async (module: any) => {
                const [lessons, quizzes] = await Promise.all([
                    LessonModel.find({ moduleId: module._id }).sort({ orderIndex: 1 }).lean(),
                    QuizModel.find({ moduleId: module._id, status: 'published' }).sort({ orderIndex: 1 }).lean(),
                ]);
                
                return {
                    moduleId: module._id.toString(),
                    title: module.title,
                    description: module.description,
                    order: module.orderIndex,
                    lessons: lessons.map((lesson: any) => {
                        // Construct video URL if not present but videoId exists
                        let videoUrl = lesson.videoUrl;
                        
                        if (!videoUrl && lesson.videoId && lesson.videoSource) {
                            if (lesson.videoSource === 'youtube') {
                                videoUrl = `https://www.youtube.com/watch?v=${lesson.videoId}`;
                            } else if (lesson.videoSource === 'googledrive') {
                                videoUrl = `https://drive.google.com/file/d/${lesson.videoId}/view`;
                            }
                        }

                        return {
                            lessonId: lesson._id.toString(),
                            title: lesson.title,
                            description: lesson.description,
                            duration: lesson.videoDuration,
                            order: lesson.orderIndex,
                            type: lesson.type,
                            media: videoUrl ? {
                                url: videoUrl,
                                type: lesson.videoSource || 'youtube',
                                videoId: lesson.videoId,
                            } : null,
                            content: lesson.content,
                            isMandatory: lesson.isMandatory,
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
        );

        return {
            ...course,
            curriculum,
        };
    },

    async getCourseBySlug(slug: string) {
        return await CourseModel.findOne({ slug }).lean();
    },

    async updateCourse(id: string, data: any) {
        const oldCourse = await CourseModel.findById(id).lean();
        const updated = await CourseModel.findByIdAndUpdate(id, data, { new: true });

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

