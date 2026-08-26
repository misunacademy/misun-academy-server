import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createActiveEnrollment,
    createModule,
    createEnrollment,
} from '../helpers/factories.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { LessonProgressModel } from '../../modules/Progress/lessonProgress.model.js';
import { ModuleProgressModel } from '../../modules/Progress/moduleProgress.model.js';
import { CourseEnrollmentService } from '../../modules/Enrollment/courseEnrollment.service.js';
import { initializeModuleProgress } from '../../modules/Enrollment/enrollmentProgress.service.js';
import { ProgressStatus, LessonType, EnrollmentStatus } from '../../types/common.js';

const buildLesson = (moduleId: mongoose.Types.ObjectId, orderIndex: number, title: string) =>
    LessonModel.create({
        moduleId,
        title,
        type: LessonType.Video,
        orderIndex,
        videoSource: 'youtube',
        videoId: `vid-${orderIndex}`,
        videoDuration: 600,
    });

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('CourseEnrollmentService.completeLesson — sequential locking (FLOW-01)', () => {
    it('completes a lesson in the unlocked first module', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);

        const lesson = await buildLesson(m1._id, 1, 'Lesson 1');
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await initializeModuleProgress(enrollment._id.toString());

        const result = await CourseEnrollmentService.completeLesson(
            user._id.toString(),
            course._id.toString(),
            m1._id.toString(),
            lesson._id.toString()
        );

        expect(result.lessonId.toString()).toBe(lesson._id.toString());

        const progress = await LessonProgressModel.findOne({
            enrollmentId: enrollment._id,
            lessonId: lesson._id,
        });
        expect(progress?.status).toBe('completed');
    });

    it('rejects completing a lesson in a locked future module, then unlocks after prerequisite', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);

        const lesson1 = await buildLesson(m1._id, 1, 'Lesson 1');
        const lesson2 = await buildLesson(m2._id, 1, 'Lesson 2');
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await initializeModuleProgress(enrollment._id.toString());

        const m2Initial = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId: m2._id,
        });
        expect(m2Initial?.status).toBe(ProgressStatus.Locked);

        await expect(
            CourseEnrollmentService.completeLesson(
                user._id.toString(),
                course._id.toString(),
                m2._id.toString(),
                lesson2._id.toString()
            )
        ).rejects.toThrow(/locked/i);

        const stillLocked = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId: m2._id,
        });
        expect(stillLocked?.status).toBe(ProgressStatus.Locked);
        const orphanedAttempt = await LessonProgressModel.countDocuments({
            enrollmentId: enrollment._id,
            lessonId: lesson2._id,
        });
        expect(orphanedAttempt).toBe(0);

        await CourseEnrollmentService.completeLesson(
            user._id.toString(),
            course._id.toString(),
            m1._id.toString(),
            lesson1._id.toString()
        );

        const m2After = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId: m2._id,
        });
        expect(m2After?.status).toBe(ProgressStatus.Unlocked);
    });

    it('rejects completion when no module progress exists for the enrollment', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(m1._id, 1, 'Orphan Lesson');
        await createActiveEnrollment(user._id, batch._id);

        await expect(
            CourseEnrollmentService.completeLesson(
                user._id.toString(),
                course._id.toString(),
                m1._id.toString(),
                lesson._id.toString()
            )
        ).rejects.toThrow(/locked/i);
    });

    it('rejects completing a lesson from a different course/batch (no active enrollment there)', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const courseA = await createCourse(admin._id, { title: 'Course A', slug: `course-a-${Date.now()}` });
        const courseB = await createCourse(admin._id, { title: 'Course B', slug: `course-b-${Date.now()}` });
        const batchA = await createBatch(courseA._id);
        const batchB = await createBatch(courseB._id);
        const mB1 = await createModule(courseB._id, batchB._id, 1);
        const lessonB = await buildLesson(mB1._id, 1, 'Course B Lesson');

        await createActiveEnrollment(user._id, batchA._id);

        await expect(
            CourseEnrollmentService.completeLesson(
                user._id.toString(),
                courseB._id.toString(),
                mB1._id.toString(),
                lessonB._id.toString()
            )
        ).rejects.toThrow(/No active enrollment found for this course/i);
    });

    it('isolates lesson progress between learners in the same batch', async () => {
        const user1 = await createUser({ email: `u1-${Date.now()}@example.com` });
        const user2 = await createUser({ email: `u2-${Date.now()}@example.com` });
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(m1._id, 1, 'Shared Lesson');

        const year = new Date().getFullYear();
        const enrollment1 = await createEnrollment(user1._id, batch._id, {
            status: EnrollmentStatus.Active,
            enrollmentId: `MA-1${year}00001`,
            enrolledAt: new Date(),
        });
        const enrollment2 = await createEnrollment(user2._id, batch._id, {
            status: EnrollmentStatus.Active,
            enrollmentId: `MA-1${year}00002`,
            enrolledAt: new Date(),
        });
        await initializeModuleProgress(enrollment1._id.toString());
        await initializeModuleProgress(enrollment2._id.toString());

        await CourseEnrollmentService.completeLesson(
            user1._id.toString(),
            course._id.toString(),
            m1._id.toString(),
            lesson._id.toString()
        );

        const user2Progress = await LessonProgressModel.find({ enrollmentId: enrollment2._id });
        expect(user2Progress).toHaveLength(0);

        const user1Progress = await LessonProgressModel.find({ enrollmentId: enrollment1._id });
        expect(user1Progress).toHaveLength(1);
    });
});
