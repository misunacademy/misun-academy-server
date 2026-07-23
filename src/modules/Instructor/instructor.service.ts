import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import slugify from '../../utils/slugify.js';
import { UserModel } from '../User/user.model.js';
import { CourseModel } from '../Course/course.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import ApiError from '../../errors/ApiError.js';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { QuizModel } from '../Quiz/quiz.model.js';
import { QuestionModel } from '../Quiz/question.model.js';
import { QuestionService } from '../Quiz/question.service.js';
import { QuizAttemptModel } from '../Quiz/attempt.model.js';
import { AttemptStatus } from '../../types/common.js';

/**
 * Resolve a userId string to a User doc with role=instructor.
 * Throws 404 if not found.
 */
const resolveInstructor = async (userId: string) => {
    const user = await UserModel.findOne({ _id: userId, role: 'instructor' }).lean();
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
    }).lean();
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
    const batch = await BatchModel.findById(batchId).lean();
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, batch.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    const enrollments = await EnrollmentModel.find({ batchId })
        .populate('userId', 'name email image')
        .select('enrollmentId status enrolledAt accessExpiresAt')
        .lean();

    return enrollments;
};

/**
 * Get batch statistics (instructor must be assigned to that course)
 */
const getBatchStatistics = async (userId: string, batchId: string) => {
    const batch = await BatchModel.findById(batchId).populate('courseId', 'title').lean();
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

    const batch = await BatchModel.findOne({ _id: batchId, courseId }).lean();
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for this course');

    const modules = await ModuleModel.find({ courseId, batchId }).sort({ orderIndex: 1 }).lean();
    return Promise.all(
        modules.map(async (mod) => {
            const lessonCount = await LessonModel.countDocuments({ moduleId: mod._id });
            return { ...mod, lessonCount };
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

    const batch = await BatchModel.findOne({ _id: batchId, courseId }).lean();
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for this course');

    if (data.orderIndex !== undefined) {
        const existing = await ModuleModel.findOne({ courseId, batchId, orderIndex: data.orderIndex }).lean();
        if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Module with this order index already exists');
    } else {
        const maxOrder = await ModuleModel.findOne({ courseId, batchId }).sort({ orderIndex: -1 }).lean();
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

    const batch = await BatchModel.findOne({ _id: batchId, courseId }).lean();
    if (!batch) throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found for this course');

    if (!Array.isArray(moduleOrders)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'moduleOrders must be an array');
    }

    await Promise.all(
        moduleOrders.map(({ moduleId, orderIndex }) =>
            ModuleModel.findByIdAndUpdate(moduleId, { orderIndex })
        )
    );

    const modules = await ModuleModel.find({ courseId, batchId }).sort({ orderIndex: 1 }).lean();
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
    const mod = await ModuleModel.findById(moduleId).lean();
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
    const mod = await ModuleModel.findById(moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    return LessonModel.find({ moduleId }).sort({ orderIndex: 1 }).lean();
};

/**
 * Create a lesson — instructor access only
 */
const createLessonForInstructor = async (userId: string, moduleId: string, data: any) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    if (data.orderIndex !== undefined) {
        const existing = await LessonModel.findOne({ moduleId, orderIndex: data.orderIndex }).lean();
        if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Lesson with this order index already exists');
    } else {
        const maxOrder = await LessonModel.findOne({ moduleId }).sort({ orderIndex: -1 }).lean();
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

    const mod = await ModuleModel.findById(lesson.moduleId).lean();
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
    const lesson = await LessonModel.findById(lessonId).lean();
    if (!lesson) throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');

    const mod = await ModuleModel.findById(lesson.moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    await LessonModel.findByIdAndDelete(lessonId);
    return null;
};


/**
 * Get quizzes for a module — instructor access only
 */
const generateUniqueQuizSlug = async (title: string, existingId?: string): Promise<string> => {
    let slug = slugify(title);
    let counter = 0;
    let uniqueSlug = slug;
    while (true) {
        const existing = await QuizModel.findOne({ slug: uniqueSlug }).lean();
        if (!existing || (existingId && existing._id?.toString() === existingId)) {
            return uniqueSlug;
        }
        counter++;
        uniqueSlug = `${slug}-${counter}`;
    }
};

const getQuizByIdForInstructor = async (userId: string, quizId: string) => {
    await resolveInstructor(userId);
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');

    const mod = await ModuleModel.findById(quiz.moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    return quiz;
};

const getModuleQuizzesForInstructor = async (userId: string, moduleId: string) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    return QuizModel.find({ moduleId }).sort({ orderIndex: 1 }).lean();
};

const createQuizForInstructor = async (userId: string, moduleId: string, data: any) => {
    await resolveInstructor(userId);
    const mod = await ModuleModel.findById(moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    if (data.orderIndex !== undefined) {
        const existing = await QuizModel.findOne({ moduleId, orderIndex: data.orderIndex }).lean();
        if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Quiz with this order index already exists');
    } else {
        const maxOrder = await QuizModel.findOne({ moduleId }).sort({ orderIndex: -1 }).lean();
        data.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    const slug = await generateUniqueQuizSlug(data.title);

    return QuizModel.create({
        ...data,
        moduleId,
        slug,
        createdBy: userId,
        totalMarks: 0,
        totalQuestions: 0,
    });
};

const updateQuizForInstructor = async (userId: string, quizId: string, data: any) => {
    await resolveInstructor(userId);
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');

    const mod = await ModuleModel.findById(quiz.moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    if (data.title && data.title !== quiz.title) {
        data.slug = await generateUniqueQuizSlug(data.title, quizId);
    }

    if (data.orderIndex !== undefined && data.orderIndex !== quiz.orderIndex) {
        const existing = await QuizModel.findOne({
            moduleId: quiz.moduleId,
            orderIndex: data.orderIndex,
            _id: { $ne: quizId },
        }).lean();
        if (existing) throw new ApiError(StatusCodes.CONFLICT, 'Quiz with this order index already exists');
    }

    const updated = await QuizModel.findByIdAndUpdate(
        quizId,
        { $set: data },
        { new: true, runValidators: true }
    );
    if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    return updated;
};

const deleteQuizForInstructor = async (userId: string, quizId: string) => {
    await resolveInstructor(userId);
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');

    const mod = await ModuleModel.findById(quiz.moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    await QuestionModel.deleteMany({ quizId });
    await QuizModel.findByIdAndDelete(quizId);
    return null;
};

const verifyQuizAccess = async (userId: string, quizId: string) => {
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');

    const mod = await ModuleModel.findById(quiz.moduleId).lean();
    if (!mod) throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');

    const hasAccess = await verifyInstructorCourseAccess(userId, mod.courseId.toString());
    if (!hasAccess) throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this course');

    return quiz;
};

const getQuizQuestionsForInstructor = async (userId: string, quizId: string) => {
    await verifyQuizAccess(userId, quizId);
    return QuestionService.getQuizQuestions(quizId);
};

const getQuestionByIdForInstructor = async (userId: string, questionId: string) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    await verifyQuizAccess(userId, question.quizId.toString());
    return QuestionService.getQuestionById(questionId);
};

const createQuestionForInstructor = async (userId: string, quizId: string, data: any) => {
    await verifyQuizAccess(userId, quizId);
    return QuestionService.createQuestion(quizId, data);
};

const updateQuestionForInstructor = async (userId: string, questionId: string, data: any) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    await verifyQuizAccess(userId, question.quizId.toString());
    return QuestionService.updateQuestion(questionId, data);
};

const deleteQuestionForInstructor = async (userId: string, questionId: string) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    await verifyQuizAccess(userId, question.quizId.toString());
    return QuestionService.deleteQuestion(questionId);
};

const duplicateQuestionForInstructor = async (userId: string, questionId: string) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    await verifyQuizAccess(userId, question.quizId.toString());
    return QuestionService.duplicateQuestion(questionId);
};

const reorderQuestionsForInstructor = async (userId: string, quizId: string, questionOrders: { questionId: string; orderIndex: number }[]) => {
    await verifyQuizAccess(userId, quizId);
    return QuestionService.reorderQuestions(quizId, questionOrders);
};

const getQuizAnalyticsForInstructor = async (userId: string, quizId: string) => {
    await verifyQuizAccess(userId, quizId);

    const [attemptStats, questionStats, questions] = await Promise.all([
        QuizAttemptModel.aggregate([
            { $match: { quizId: new Types.ObjectId(quizId), status: AttemptStatus.Completed } },
            {
                $group: {
                    _id: null,
                    totalAttempts: { $sum: 1 },
                    averageScore: { $avg: '$percentage' },
                    passCount: { $sum: { $cond: ['$passed', 1, 0] } },
                    totalEarned: { $sum: '$earnedMarks' },
                    totalMarksSum: { $sum: '$totalMarks' },
                },
            },
        ]),
        QuizAttemptModel.aggregate([
            { $match: { quizId: new Types.ObjectId(quizId), status: AttemptStatus.Completed } },
            { $unwind: '$answers' },
            {
                $group: {
                    _id: '$answers.questionId',
                    attemptCount: { $sum: 1 },
                    correctCount: { $sum: { $cond: ['$answers.isCorrect', 1, 0] } },
                },
            },
        ]),
        QuestionModel.find({ quizId }).sort({ orderIndex: 1 }).lean(),
    ]);

    const stats = attemptStats[0] || { totalAttempts: 0, averageScore: 0, passCount: 0 };
    const passRate = stats.totalAttempts > 0 ? Math.round((stats.passCount / stats.totalAttempts) * 100) : 0;

    const questionStatsMap = new Map<string, { attemptCount: number; correctCount: number }>();
    for (const qs of questionStats) {
        questionStatsMap.set(qs._id.toString(), { attemptCount: qs.attemptCount, correctCount: qs.correctCount });
    }

    const perQuestion = questions.map(q => {
        const qs = questionStatsMap.get(q._id.toString());
        return {
            _id: q._id,
            content: q.content,
            marks: q.marks,
            orderIndex: q.orderIndex,
            attemptCount: qs?.attemptCount || 0,
            correctCount: qs?.correctCount || 0,
            correctPercent: qs?.attemptCount ? Math.round((qs.correctCount / qs.attemptCount) * 100) : 0,
        };
    });

    return {
        totalAttempts: stats.totalAttempts,
        averageScore: Math.round(stats.averageScore),
        passRate,
        perQuestion,
    };
};

/**
 * Get all enrolled students for the instructor with pagination and filtering
 */
const getInstructorEnrolledStudents = async (userId: string, query: any) => {
    await resolveInstructor(userId);

    const { page = 1, limit = 10, search, status, courseId, batchId } = query;
    const skip = (Number(page) - 1) * Number(limit);

    // 1. Get allowed courses for this instructor
    const courseQuery: any = { instructorId: new Types.ObjectId(userId) };
    if (courseId && courseId !== 'all') {
        courseQuery._id = new Types.ObjectId(courseId);
    }
    const courses = await CourseModel.find(courseQuery).select('_id title').lean();
    const courseIds = courses.map(c => c._id);

    if (courseIds.length === 0) {
        return { meta: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0 }, data: [] };
    }

    // 2. Get allowed batches
    const batchQuery: any = { courseId: { $in: courseIds } };
    if (batchId && batchId !== 'all') {
        batchQuery._id = new Types.ObjectId(batchId);
    }
    const batches = await BatchModel.find(batchQuery).select('_id title courseId').lean();
    const batchIds = batches.map(b => b._id);

    if (batchIds.length === 0) {
        return { meta: { total: 0, page: Number(page), limit: Number(limit), totalPages: 0 }, data: [] };
    }

    // 3. Construct enrollment query
    const enrollmentQuery: any = { batchId: { $in: batchIds } };
    
    if (status && status !== 'all') {
        enrollmentQuery.status = new RegExp(`^${status}$`, 'i');
    }

    // If there is a search term, we need to find matching users first
    if (search) {
        const matchingUsers = await UserModel.find({
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ]
        }).select('_id').lean();
        const userIds = matchingUsers.map(u => u._id);
        enrollmentQuery.userId = { $in: userIds };
    }

    const total = await EnrollmentModel.countDocuments(enrollmentQuery);
    const enrollments = await EnrollmentModel.find(enrollmentQuery)
        .populate('userId', 'name email phone image')
        .skip(skip)
        .limit(Number(limit))
        .sort({ enrolledAt: -1 })
        .lean();

    // Attach course and batch info
    const data = enrollments.map((enr: any) => {
        const batch = batches.find(b => b._id.toString() === enr.batchId?.toString());
        const course = courses.find(c => c._id.toString() === batch?.courseId?.toString());
        return {
            ...enr,
            batchTitle: batch?.title,
            courseTitle: course?.title,
        };
    });

    return {
        meta: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / Number(limit))
        },
        data,
    };
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
    getModuleQuizzesForInstructor,
    getQuizByIdForInstructor,
    createQuizForInstructor,
    updateQuizForInstructor,
    deleteQuizForInstructor,
    getQuizQuestionsForInstructor,
    getQuestionByIdForInstructor,
    createQuestionForInstructor,
    updateQuestionForInstructor,
    deleteQuestionForInstructor,
    duplicateQuestionForInstructor,
    reorderQuestionsForInstructor,
    getInstructorEnrolledStudents,
    getQuizAnalyticsForInstructor,
};
