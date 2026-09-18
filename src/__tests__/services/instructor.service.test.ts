import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createModule } from '../helpers/factories.js';
import { InstructorService } from '../../modules/Instructor/instructor.service.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { QuizModel } from '../../modules/Quiz/quiz.model.js';
import { QuestionModel } from '../../modules/Quiz/question.model.js';
import { EnrollmentStatus } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

let admin: any;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
    admin = await createAdmin({ role: 'superadmin' });
});

const createInstructor = (overrides: Record<string, unknown> = {}) =>
    createUser({ email: `instr-${uniq()}@example.com`, role: 'instructor', ...overrides });

// A course owned by the instructor + one batch + one module; returns all ids.
const setupAssignedCourse = async (instructorId: any) => {
    const course = await createCourse(admin._id, { instructorId });
    const batch = await createBatch(course._id);
    const mod = await createModule(course._id, batch._id, 0);
    return { course, batch, mod };
};

const createLesson = (moduleId: any, orderIndex = 0, overrides: Record<string, unknown> = {}) =>
    LessonModel.create({
        moduleId,
        title: `Lesson ${orderIndex} ${uniq()}`,
        type: 'video',
        orderIndex,
        ...overrides,
    });

const mcqPayload = (overrides: Record<string, unknown> = {}) => ({
    questionType: 'mcq',
    content: { type: 'text', text: `What is 2+2? ${uniq()}` },
    options: [
        { type: 'text', text: '3' },
        { type: 'text', text: '4' },
    ],
    correctAnswer: '4',
    marks: 2,
    ...overrides,
});

describe('InstructorService.getProfile / updateProfile', () => {
    it('returns the instructor with assigned courses', async () => {
        const instructor = await createInstructor();
        await setupAssignedCourse(instructor._id);

        const profile: any = await InstructorService.getProfile(instructor._id.toString());
        expect(profile.user.email).toBe(instructor.email);
        expect(profile.assignedCourses).toHaveLength(1);
    });

    it('throws NOT_FOUND for non-instructors and unknown ids', async () => {
        const learner = await createUser({ email: `l-${uniq()}@example.com`, role: 'learner' });
        await expect(
            InstructorService.getProfile(learner._id.toString())
        ).rejects.toThrow(/Instructor not found/i);
        await expect(
            InstructorService.getProfile(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/Instructor not found/i);
    });

    it('updateProfile renames the instructor', async () => {
        const instructor = await createInstructor();
        const updated: any = await InstructorService.updateProfile(instructor._id.toString(), {
            name: 'Renamed Instructor',
        });
        expect(updated.name).toBe('Renamed Instructor');
    });

    it('updateProfile throws for unknown instructor', async () => {
        await expect(
            InstructorService.updateProfile(new mongoose.Types.ObjectId().toString(), { name: 'x' })
        ).rejects.toThrow(/Instructor not found/i);
    });
});

describe('InstructorService courses & batches', () => {
    it('getCoursesWithBatches nests batches under each course', async () => {
        const instructor = await createInstructor();
        const { course, batch } = await setupAssignedCourse(instructor._id);

        const result: any[] = await InstructorService.getCoursesWithBatches(instructor._id.toString());
        expect(result).toHaveLength(1);
        expect(result[0]._id.toString()).toBe(course._id.toString());
        expect(result[0].batches.map((b: any) => b._id.toString())).toContain(batch._id.toString());
    });

    it('getBatchStudents returns the roster for the assigned instructor', async () => {
        const instructor = await createInstructor();
        const { batch } = await setupAssignedCourse(instructor._id);
        const student = await createUser({ email: `stud-${uniq()}@example.com` });
        await EnrollmentModel.create({
            userId: student._id,
            batchId: batch._id,
            status: EnrollmentStatus.Active,
            enrollmentId: `MA-${uniq()}`,
        });

        const roster: any[] = await InstructorService.getBatchStudents(
            instructor._id.toString(),
            batch._id.toString()
        );
        expect(roster).toHaveLength(1);
        expect(roster[0].userId.email).toBe(student.email);
    });

    it('getBatchStudents forbids instructors not assigned to the course', async () => {
        const instructor = await createInstructor();
        const stranger = await createInstructor();
        const { batch } = await setupAssignedCourse(instructor._id);

        await expect(
            InstructorService.getBatchStudents(stranger._id.toString(), batch._id.toString())
        ).rejects.toThrow(/not assigned/i);
    });

    it('getBatchStudents throws for unknown batch', async () => {
        const instructor = await createInstructor();
        await expect(
            InstructorService.getBatchStudents(
                instructor._id.toString(),
                new mongoose.Types.ObjectId().toString()
            )
        ).rejects.toThrow(/Batch not found/i);
    });

    // Regression: getBatchStatistics used to call .toString() on the
    // populated courseId object ("[object Object]" CastError) and counted
    // active enrollments with a capitalized 'Active' that never matches.
    it('returns batch statistics for the assigned course', async () => {
        const instructor = await createInstructor();
        const { batch } = await setupAssignedCourse(instructor._id);
        const s1 = await createUser({ email: `s1-${uniq()}@example.com` });
        await EnrollmentModel.create({
            userId: s1._id, batchId: batch._id,
            status: EnrollmentStatus.Active, enrollmentId: `MA-${uniq()}`,
        });

        const stats: any = await InstructorService.getBatchStatistics(
            instructor._id.toString(), batch._id.toString()
        );

        expect(stats.enrollments.total).toBe(1);
        expect(stats.enrollments.active).toBe(1);
        expect(stats.batch.title).toBe(batch.title);
    });
});

describe('InstructorService modules', () => {
    it('createModuleForInstructor auto-assigns orderIndex and detects conflicts', async () => {
        const instructor = await createInstructor();
        const { course, batch } = await setupAssignedCourse(instructor._id);
        const uid = instructor._id.toString();

        const created: any = await InstructorService.createModuleForInstructor(
            uid, course._id.toString(), batch._id.toString(), {
                title: `Auto ${uniq()}`,
                description: 'Auto-created module',
                estimatedDuration: '2 hours',
            }
        );
        expect(created.orderIndex).toBe(1); // setup module occupies 0

        await expect(
            InstructorService.createModuleForInstructor(uid, course._id.toString(), batch._id.toString(), {
                title: 'Clash', orderIndex: 1,
                description: 'Clash module',
                estimatedDuration: '1 hour',
            })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('getCourseModulesForInstructor includes lesson counts', async () => {
        const instructor = await createInstructor();
        const { course, batch, mod } = await setupAssignedCourse(instructor._id);
        await createLesson(mod._id, 0);
        await createLesson(mod._id, 1);

        const modules: any[] = await InstructorService.getCourseModulesForInstructor(
            instructor._id.toString(), course._id.toString(), batch._id.toString()
        );
        expect(modules).toHaveLength(1);
        expect(modules[0].lessonCount).toBe(2);
    });

    it('updateModuleForInstructor renames and enforces access', async () => {
        const instructor = await createInstructor();
        const stranger = await createInstructor();
        const { mod } = await setupAssignedCourse(instructor._id);

        const updated: any = await InstructorService.updateModuleForInstructor(
            instructor._id.toString(), mod._id.toString(), { title: 'Renamed Module' }
        );
        expect(updated.title).toBe('Renamed Module');

        await expect(
            InstructorService.updateModuleForInstructor(stranger._id.toString(), mod._id.toString(), {
                title: 'Hijack',
            })
        ).rejects.toThrow(/not assigned/i);
    });

    it('deleteModuleForInstructor blocks deletion when lessons exist', async () => {
        const instructor = await createInstructor();
        const { mod } = await setupAssignedCourse(instructor._id);
        await createLesson(mod._id, 0);

        await expect(
            InstructorService.deleteModuleForInstructor(instructor._id.toString(), mod._id.toString())
        ).rejects.toThrow(/existing lessons/i);
    });

    it('deleteModuleForInstructor removes empty modules', async () => {
        const instructor = await createInstructor();
        const { mod } = await setupAssignedCourse(instructor._id);
        await InstructorService.deleteModuleForInstructor(instructor._id.toString(), mod._id.toString());
        const { ModuleModel } = await import('../../modules/Module/module.model.js');
        expect(await ModuleModel.countDocuments({ _id: mod._id })).toBe(0);
    });

    it('reorderCourseModulesForInstructor reorders and returns sorted list', async () => {
        const instructor = await createInstructor();
        const { course, batch, mod } = await setupAssignedCourse(instructor._id);
        const uid = instructor._id.toString();
        const second: any = await InstructorService.createModuleForInstructor(
            uid, course._id.toString(), batch._id.toString(), {
                title: `Second ${uniq()}`,
                description: 'Second module',
                estimatedDuration: '2 hours',
            }
        );

        const reordered: any[] = await InstructorService.reorderCourseModulesForInstructor(
            uid, course._id.toString(), batch._id.toString(), [
                { moduleId: second._id.toString(), orderIndex: 0 },
                { moduleId: mod._id.toString(), orderIndex: 1 },
            ]
        );
        expect(reordered[0]._id.toString()).toBe(second._id.toString());
        expect(reordered[1]._id.toString()).toBe(mod._id.toString());
    });

    it('reorderCourseModulesForInstructor rejects non-array input', async () => {
        const instructor = await createInstructor();
        const { course, batch } = await setupAssignedCourse(instructor._id);
        await expect(
            InstructorService.reorderCourseModulesForInstructor(
                instructor._id.toString(), course._id.toString(), batch._id.toString(), 'nope' as any
            )
        ).rejects.toThrow(/must be an array/i);
    });
});

describe('InstructorService lessons', () => {
    it('creates, lists, updates and deletes lessons with order handling', async () => {
        const instructor = await createInstructor();
        const { mod } = await setupAssignedCourse(instructor._id);
        const uid = instructor._id.toString();

        const lesson: any = await InstructorService.createLessonForInstructor(uid, mod._id.toString(), {
            title: `Intro ${uniq()}`, type: 'video',
        });
        expect(lesson.orderIndex).toBe(0);

        await expect(
            InstructorService.createLessonForInstructor(uid, mod._id.toString(), {
                title: 'Clash', type: 'video', orderIndex: 0,
            })
        ).rejects.toThrow(/order index already exists/i);

        const listed: any[] = await InstructorService.getModuleLessonsForInstructor(
            uid, mod._id.toString()
        );
        expect(listed).toHaveLength(1);

        const updated: any = await InstructorService.updateLessonForInstructor(
            uid, lesson._id.toString(), { title: 'Updated Lesson' }
        );
        expect(updated.title).toBe('Updated Lesson');

        await InstructorService.deleteLessonForInstructor(uid, lesson._id.toString());
        expect(await LessonModel.countDocuments({ _id: lesson._id })).toBe(0);
    });

    it('enforces course assignment on lesson reads', async () => {
        const instructor = await createInstructor();
        const stranger = await createInstructor();
        const { mod } = await setupAssignedCourse(instructor._id);

        await expect(
            InstructorService.getModuleLessonsForInstructor(stranger._id.toString(), mod._id.toString())
        ).rejects.toThrow(/not assigned/i);
    });

    it('throws NOT_FOUND for unknown lesson/module', async () => {
        const instructor = await createInstructor();
        await setupAssignedCourse(instructor._id);
        const uid = instructor._id.toString();

        await expect(
            InstructorService.updateLessonForInstructor(uid, new mongoose.Types.ObjectId().toString(), {})
        ).rejects.toThrow(/Lesson not found/i);
        await expect(
            InstructorService.createLessonForInstructor(uid, new mongoose.Types.ObjectId().toString(), {
                title: 'x', type: 'video',
            })
        ).rejects.toThrow(/Module not found/i);
    });
});

describe('InstructorService quizzes & questions', () => {
    const setupQuiz = async () => {
        const instructor = await createInstructor();
        const { mod } = await setupAssignedCourse(instructor._id);
        const quiz: any = await InstructorService.createQuizForInstructor(
            instructor._id.toString(), mod._id.toString(), { title: `Quiz ${uniq()}` }
        );
        return { instructor, mod, quiz };
    };

    it('creates quizzes with unique slugs and detects order conflicts', async () => {
        const { instructor, mod, quiz } = await setupQuiz();
        const uid = instructor._id.toString();
        expect(quiz.slug).toBeTruthy();
        expect(quiz.orderIndex).toBe(0);

        const sameTitle: any = await InstructorService.createQuizForInstructor(
            uid, mod._id.toString(), { title: quiz.title }
        );
        expect(sameTitle.slug).not.toBe(quiz.slug);

        await expect(
            InstructorService.createQuizForInstructor(uid, mod._id.toString(), {
                title: `Other ${uniq()}`, orderIndex: 0,
            })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('reads, renames (slug regen) and deletes quizzes', async () => {
        const { instructor, quiz } = await setupQuiz();
        const uid = instructor._id.toString();

        const fetched: any = await InstructorService.getQuizByIdForInstructor(uid, quiz._id.toString());
        expect(fetched._id.toString()).toBe(quiz._id.toString());

        const renamed: any = await InstructorService.updateQuizForInstructor(uid, quiz._id.toString(), {
            title: `Renamed ${uniq()}`,
        });
        expect(renamed.slug).not.toBe(quiz.slug);

        const listed: any[] = await InstructorService.getModuleQuizzesForInstructor(
            uid, (await setupQuizContextModule(quiz)) as string
        );
        expect(listed.length).toBeGreaterThanOrEqual(1);

        await InstructorService.deleteQuizForInstructor(uid, quiz._id.toString());
        expect(await QuizModel.countDocuments({ _id: quiz._id })).toBe(0);
        // cascade: questions removed
        expect(await QuestionModel.countDocuments({ quizId: quiz._id })).toBe(0);
    });

    it('manages questions through instructor wrappers', async () => {
        const { instructor, quiz } = await setupQuiz();
        const uid = instructor._id.toString();

        const q: any = await InstructorService.createQuestionForInstructor(
            uid, quiz._id.toString(), mcqPayload()
        );
        expect(q.quizId.toString()).toBe(quiz._id.toString());

        const list: any[] = await InstructorService.getQuizQuestionsForInstructor(
            uid, quiz._id.toString()
        );
        expect(list).toHaveLength(1);

        const single: any = await InstructorService.getQuestionByIdForInstructor(uid, q._id.toString());
        expect(single._id.toString()).toBe(q._id.toString());

        const updated: any = await InstructorService.updateQuestionForInstructor(
            uid, q._id.toString(), { marks: 5 }
        );
        expect(updated.marks).toBe(5);

        const dup: any = await InstructorService.duplicateQuestionForInstructor(uid, q._id.toString());
        expect(dup._id.toString()).not.toBe(q._id.toString());

        const reordered: any[] = await InstructorService.reorderQuestionsForInstructor(
            uid, quiz._id.toString(), [
                { questionId: dup._id.toString(), orderIndex: 0 },
                { questionId: q._id.toString(), orderIndex: 1 },
            ]
        );
        expect(reordered[0]._id.toString()).toBe(dup._id.toString());

        await InstructorService.deleteQuestionForInstructor(uid, q._id.toString());
        expect(await QuestionModel.countDocuments({ _id: q._id })).toBe(0);
    });

    it('getQuizAnalyticsForInstructor returns zeroed stats with no attempts', async () => {
        const { instructor, quiz } = await setupQuiz();
        await InstructorService.createQuestionForInstructor(
            instructor._id.toString(), quiz._id.toString(), mcqPayload()
        );

        const analytics: any = await InstructorService.getQuizAnalyticsForInstructor(
            instructor._id.toString(), quiz._id.toString()
        );
        expect(analytics.totalAttempts).toBe(0);
        expect(analytics.passRate).toBe(0);
        expect(analytics.perQuestion).toHaveLength(1);
        expect(analytics.perQuestion[0].correctPercent).toBe(0);
    });

    it('quiz access is denied for unassigned instructors', async () => {
        const { quiz } = await setupQuiz();
        const stranger = await createInstructor();
        await expect(
            InstructorService.getQuizByIdForInstructor(stranger._id.toString(), quiz._id.toString())
        ).rejects.toThrow(/not assigned/i);
    });
});

describe('InstructorService.getInstructorEnrolledStudents', () => {
    it('returns empty set when instructor has no courses', async () => {
        const instructor = await createInstructor();
        const result = await InstructorService.getInstructorEnrolledStudents(
            instructor._id.toString(), { page: 1, limit: 10 }
        );
        expect(result.meta.total).toBe(0);
        expect(result.data).toEqual([]);
    });

    it('paginates, searches and filters by status/course/batch', async () => {
        const instructor = await createInstructor();
        const { course, batch } = await setupAssignedCourse(instructor._id);
        const uid = instructor._id.toString();
        const s1 = await createUser({ email: `alpha-${uniq()}@example.com`, name: 'Alpha Student' });
        const s2 = await createUser({ email: `beta-${uniq()}@example.com`, name: 'Beta Student' });
        await EnrollmentModel.create({
            userId: s1._id, batchId: batch._id,
            status: EnrollmentStatus.Active, enrollmentId: `MA-${uniq()}`,
        });
        await EnrollmentModel.create({
            userId: s2._id, batchId: batch._id,
            status: EnrollmentStatus.Pending, enrollmentId: `MA-${uniq()}`,
        });

        const all: any = await InstructorService.getInstructorEnrolledStudents(uid, { page: 1, limit: 10 });
        expect(all.meta.total).toBe(2);

        const searched: any = await InstructorService.getInstructorEnrolledStudents(uid, {
            page: 1, limit: 10, search: 'alpha',
        });
        expect(searched.meta.total).toBe(1);

        const active: any = await InstructorService.getInstructorEnrolledStudents(uid, {
            page: 1, limit: 10, status: 'active',
        });
        expect(active.meta.total).toBe(1);

        const byCourse: any = await InstructorService.getInstructorEnrolledStudents(uid, {
            page: 1, limit: 10, courseId: course._id.toString(),
        });
        expect(byCourse.meta.total).toBe(2);

        const byBatch: any = await InstructorService.getInstructorEnrolledStudents(uid, {
            page: 1, limit: 10, batchId: batch._id.toString(),
        });
        expect(byBatch.meta.total).toBe(2);
        expect(byBatch.data[0].batchTitle).toBe(batch.title);
        expect(byBatch.data[0].courseTitle).toBe(course.title);
    });
});

// helper: resolve the module id backing a quiz
const setupQuizContextModule = async (quiz: any): Promise<string> => {
    const fresh = await QuizModel.findById(quiz._id).lean();
    return (fresh?.moduleId as unknown as string).toString();
};
