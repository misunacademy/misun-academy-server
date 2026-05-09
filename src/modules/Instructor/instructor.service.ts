import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import { UserModel } from '../User/user.model.js';
import { CourseModel } from '../Course/course.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import ApiError from '../../errors/ApiError.js';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';

/**
 * Resolve a userId string to a User doc with role=instructor.
 * Throws 404 if not found.
 */
const resolveInstructor = async (userId: string) => {
    const user = await UserModel.findOne({ _id: userId, role: 'instructor' });
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor not found');
    return user;
};

/**
 * Helper: verify that userId is the assigned instructor for courseId.
 */
const verifyInstructorCourseAccess = async (
    userId: string,
    courseId: string
): Promise<boolean> => {
    const course = await CourseModel.findOne({
        _id: courseId,
        instructorId: new Types.ObjectId(userId),
    });
    return !!course;
};

/**
 * Get instructor profile (user data + assigned courses summary)
 */
const getProfile = async (userId: string) => {
    const user = await resolveInstructor(userId);
    const assignedCourses = await CourseModel.find({ instructorId: user._id })
        .select('title slug thumbnailImage status category level shortDescription')
        .lean();
    return { user, assignedCourses };
};

/**
 * Update instructor profile fields (name, image via UserModel)
 */
const updateProfile = async (
    userId: string,
    updateData: { name?: string; image?: string }
) => {
    const user = await UserModel.findOneAndUpdate(
        { _id: userId, role: 'instructor' },
        updateData,
        { new: true, runValidators: true }
    );
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor not found');
    return user;
};


/**
 * Get all courses assigned to this instructor
 */
const getCoursesWithBatches = async (userId: string) => {
    await resolveInstructor(userId);

    const courses = await CourseModel.find({ instructorId: new Types.ObjectId(userId) })
        .select('title slug shortDescription thumbnailImage status category level')
        .lean();

    const result = await Promise.all(
        courses.map(async (course: any) => {
            const batches = await BatchModel.find({ courseId: course._id })
                .select('title batchNumber status startDate endDate currentEnrollment')
                .lean();
            return { ...course, batches };
        })
    );

    return result;
};

/**
 * Get batch students roster (instructor must be assigned to that course)
 */
const getBatchStudents = async (userId: string, batchId: string) => {
    const batch = await BatchModel.findById(batchId);
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, batch.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const enrollments = await EnrollmentModel.find({ batchId })
        .populate('userId', 'name email image')
        .select('enrollmentId status enrolledAt accessExpiresAt');

    return enrollments;
};

/**
 * Get batch statistics (instructor must be assigned to that course)
 */
const getBatchStatistics = async (userId: string, batchId: string) => {
    const batch = await BatchModel.findById(batchId).populate('courseId', 'title');
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, batch.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const totalEnrollments = await EnrollmentModel.countDocuments({ batchId });
    const activeEnrollments = await EnrollmentModel.countDocuments({ batchId, status: 'Active' });

    return {
        batch: {
            title: batch.title,
            batchNumber: batch.batchNumber,
            course: batch.courseId,
        },
        enrollments: { total: totalEnrollments, active: activeEnrollments },
    };
};

/**
 * Get modules for a course — instructor access only
 */
const getCourseModulesForInstructor = async (userId: string, courseId: string, batchId: string) => {
    await resolveInstructor(userId);
    const hasAccess = await verifyInstructorCourseAccess(userId, courseId);
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const batch = await BatchModel.findOne({ _id: batchId, courseId });
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for this course');

    const modules = await ModuleModel.find({ courseId, batchId }).sort({ orderIndex: 1 });
    return Promise.all(
        modules.map(async (mod) => {
            const lessonCount = await LessonModel.countDocuments({ moduleId: mod._id });
            return { ...mod.toObject(), lessonCount };
        })
    );
};

/**
 * Create a module for an assigned course
 */
const createModuleForInstructor = async (userId: string, courseId: string, batchId: string, data: any) => {
    await resolveInstructor(userId);
    const hasAccess = await verifyInstructorCourseAccess(userId, courseId);
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const batch = await BatchModel.findOne({ _id: batchId, courseId });
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for this course');

    if (data.orderIndex !== undefined) {
        const existing = await ModuleModel.findOne({ courseId, batchId, orderIndex: data.orderIndex });
        if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Module with this order index already exists');
    } else {
        const maxOrder = await ModuleModel.findOne({ courseId, batchId }).sort({ orderIndex: -1 });
        data.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    return ModuleModel.create({ ...data, courseId, batchId });
};

/**
 * Reorder modules for an assigned course
 */
const reorderCourseModulesForInstructor = async (
    userId: string,
    courseId: string,
    batchId: string,
    moduleOrders: { moduleId: string; orderIndex: number }[]
) => {
    await resolveInstructor(userId);
    const hasAccess = await verifyInstructorCourseAccess(userId, courseId);
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const batch = await BatchModel.findOne({ _id: batchId, courseId });
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for this course');

    if (!Array.isArray(moduleOrders)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'moduleOrders must be an array');
    }

    await Promise.all(
        moduleOrders.map(({ moduleId, orderIndex }) =>
            ModuleModel.findByIdAndUpdate(moduleId, { orderIndex })
        )
    );

    const modules = await ModuleModel.find({ courseId, batchId }).sort({ orderIndex: 1 });
    return modules;
};

/**
 * Update a module — instructor access only
 */
const updateModuleForInstructor = async (userId: string, moduleId: string, data: any) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId);
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    Object.assign(mod, data);
    await mod.save();
    return mod;
};

/**
 * Delete a module — instructor access only
 */
const deleteModuleForInstructor = async (userId: string, moduleId: string) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId);
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const lessonCount = await LessonModel.countDocuments({ moduleId });
    if (lessonCount > 0) throw new ApiError(StatusCodes.BAD_REQUEST, 'Cannot delete module with existing lessons. Delete lessons first.');

    await ModuleModel.findByIdAndDelete(moduleId);
    return null;
};

/**
 * Get lessons for a module — instructor access only
 */
const getModuleLessonsForInstructor = async (userId: string, moduleId: string) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId);
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    return LessonModel.find({ moduleId }).sort({ orderIndex: 1 });
};

/**
 * Create a lesson — instructor access only
 */
const createLessonForInstructor = async (userId: string, moduleId: string, data: any) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId);
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    if (data.orderIndex !== undefined) {
        const existing = await LessonModel.findOne({ moduleId, orderIndex: data.orderIndex });
        if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Lesson with this order index already exists');
    } else {
        const maxOrder = await LessonModel.findOne({ moduleId }).sort({ orderIndex: -1 });
        data.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    return LessonModel.create({ ...data, moduleId });
};

/**
 * Update a lesson — instructor access only
 */
const updateLessonForInstructor = async (userId: string, lessonId: string, data: any) => {
    await resolveInstructor(userId);
    const lesson = await LessonModel.findById(lessonId);
    if (!lesson) throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');

    const mod = await ModuleModel.findById(lesson.moduleId);
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    Object.assign(lesson, data);
    await lesson.save();
    return lesson;
};

/**
 * Delete a lesson — instructor access only
 */
const deleteLessonForInstructor = async (userId: string, lessonId: string) => {
    await resolveInstructor(userId);
    const lesson = await LessonModel.findById(lessonId);
    if (!lesson) throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');

    const mod = await ModuleModel.findById(lesson.moduleId);
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    await LessonModel.findByIdAndDelete(lessonId);
    return null;
};


export const InstructorService = {
    getProfile,
    updateProfile,
    getCoursesWithBatches,
    getBatchStudents,
    getBatchStatistics,
    getCourseModulesForInstructor,
    createModuleForInstructor,
    reorderCourseModulesForInstructor,
    updateModuleForInstructor,
    deleteModuleForInstructor,
    getModuleLessonsForInstructor,
    createLessonForInstructor,
    updateLessonForInstructor,
    deleteLessonForInstructor,
};
