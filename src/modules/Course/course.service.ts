import { FilterQuery } from 'mongoose';
import { CourseModel } from './course.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { ICourse } from './course.interface.js';

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

        // Add students count for each course
        const coursesWithCount = await Promise.all(
            data.map(async (course:ICourse) => {
                const count = await EnrollmentModel.countDocuments({ 
                    course: course._id, 
                    status: { $ne: 'cancelled' } 
                });
                return { ...course, studentsCount: count };
            })
        );

        return { data: coursesWithCount, total, page, perPage };
    },

    async getCourseById(id: string) {
        const course = await CourseModel.findById(id).lean();
        
        if (!course) return null;

        // Fetch modules and lessons for this course
        // const ModuleModel = require('../Module/module.model').ModuleModel;
        // const LessonModel = require('../Lesson/lesson.model').LessonModel;
        
        const modules = await ModuleModel.find({ courseId: id }).sort({ order: 1 }).lean();
        
        // Fetch lessons for each module
        const curriculum = await Promise.all(
            modules.map(async (module: any) => {
                const lessons = await LessonModel.find({ moduleId: module._id })
                    .sort({ order: 1 })
                    .lean();
                
                return {
                    moduleId: module._id.toString(),
                    title: module.title,
                    description: module.description,
                    order: module.order,
                    lessons: lessons.map((lesson: any) => {
                        // Construct video URL if not present but videoId exists
                        let videoUrl = lesson.videoUrl;
                        
                        if (!videoUrl && lesson.videoId && lesson.videoSource) {
                            if (lesson.videoSource === 'youtube') {
                                videoUrl = `https://www.youtube.com/watch?v=${lesson.videoId}`;
                            } else if (lesson.videoSource === 'google_drive') {
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
                };
            })
        );

        return {
            ...course,
            curriculum,
        };
    },

    async getCourseBySlug(slug: string) {
        return await CourseModel.findOne({ slug });
    },

    async updateCourse(id: string, data: any) {
        return await CourseModel.findByIdAndUpdate(id, data, { new: true });
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
    }
};
