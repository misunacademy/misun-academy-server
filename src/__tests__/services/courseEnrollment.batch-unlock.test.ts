import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createActiveEnrollment,
    createModule,
    createModuleProgress,
} from '../helpers/factories.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { ModuleProgressModel } from '../../modules/Progress/moduleProgress.model.js';
import { CourseEnrollmentService } from '../../modules/Enrollment/courseEnrollment.service.js';
import { initializeModuleProgress } from '../../modules/Enrollment/enrollmentProgress.service.js';
import { ProgressStatus, LessonType } from '../../types/common.js';

const buildLesson = (moduleId: unknown, title: string) =>
    LessonModel.create({
        moduleId,
        title,
        type: LessonType.Video,
        orderIndex: 0,
        videoSource: 'youtube',
        videoId: `vid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe('CourseEnrollmentService — batch-scoped unlocking', () => {
    it('unlocks the next module of the SAME batch, never a sibling batch module', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batchA = await createBatch(course._id, { batchNumber: 11, title: 'Batch A' });
        const batchB = await createBatch(course._id, { batchNumber: 22, title: 'Batch B' });

        // Insert batch B modules FIRST so an unscoped {courseId, orderIndex}
        // lookup would deterministically hit the wrong batch.
        const modB0 = await createModule(course._id, batchB._id, 0);
        const modB1 = await createModule(course._id, batchB._id, 1);
        const modA0 = await createModule(course._id, batchA._id, 0);
        const modA1 = await createModule(course._id, batchA._id, 1);

        const enrollmentA = await createActiveEnrollment(user._id, batchA._id);
        await initializeModuleProgress(enrollmentA._id.toString());
        const lessonA0 = await buildLesson(modA0._id, 'A Lesson 0');

        await CourseEnrollmentService.completeLesson(
            user._id.toString(),
            course._id.toString(),
            modA0._id.toString(),
            lessonA0._id.toString()
        );

        const nextA = await ModuleProgressModel.findOne({
            enrollmentId: enrollmentA._id,
            moduleId: modA1._id,
        }).lean();
        expect(nextA?.status).toBe(ProgressStatus.Unlocked);

        // No progress row may reference the sibling batch's modules.
        const stray = await ModuleProgressModel.countDocuments({
            enrollmentId: enrollmentA._id,
            moduleId: { $in: [modB0._id, modB1._id] },
        });
        expect(stray).toBe(0);
    });
});

describe('CourseEnrollmentService — self-heal of stale locked rows', () => {
    it('unlocks a locked module whose predecessors are all completed on next progress read', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m0 = await createModule(course._id, batch._id, 0);
        const m1 = await createModule(course._id, batch._id, 1);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        // Simulate history: m0 fully done, but m1 never got unlocked.
        await createModuleProgress(enrollment._id, m0._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });
        await createModuleProgress(enrollment._id, m1._id, { status: ProgressStatus.Locked });

        const progress = await CourseEnrollmentService.getCourseProgress(
            user._id.toString(),
            course._id.toString(),
            batch._id.toString()
        );

        const healed = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId: m1._id,
        }).lean();
        expect(healed?.status).toBe(ProgressStatus.Unlocked);
        expect(progress).toBeDefined();
    });

    it('keeps later modules locked until their immediate predecessor completes', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m0 = await createModule(course._id, batch._id, 0);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await createModuleProgress(enrollment._id, m0._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });
        await createModuleProgress(enrollment._id, m1._id, { status: ProgressStatus.Locked });
        await createModuleProgress(enrollment._id, m2._id, { status: ProgressStatus.Locked });

        await CourseEnrollmentService.getCourseProgress(
            user._id.toString(),
            course._id.toString(),
            batch._id.toString()
        );

        // m1 heals to Unlocked, but m2 must stay Locked (m1 is not completed).
        const states = await ModuleProgressModel.find({ enrollmentId: enrollment._id }).lean();
        const byModule = new Map(states.map((s) => [s.moduleId.toString(), s.status]));
        expect(byModule.get(m1._id.toString())).toBe(ProgressStatus.Unlocked);
        expect(byModule.get(m2._id.toString())).toBe(ProgressStatus.Locked);
    });
});
