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
    createModuleProgress,
} from '../helpers/factories.js';
import { ResourceModel } from '../../modules/Resource/resource.model.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { ContentService } from '../../modules/Content/content.service.js';
import { LessonType, ProgressStatus, ResourceType } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildLesson = (moduleId: mongoose.Types.ObjectId, orderIndex: number) =>
    LessonModel.create({
        moduleId,
        title: `Lesson ${orderIndex}-${uniq()}`,
        type: LessonType.Video,
        orderIndex,
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

describe('Resource model — CRUD and validation', () => {
    it('creates file/link/document resources attached to a lesson', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(mod._id, 1);

        const file = await ResourceModel.create({
            lessonId: lesson._id, title: 'Slides', type: ResourceType.File,
            fileUrl: 'https://cdn.example.com/slides.pdf', fileName: 'slides.pdf',
            fileSize: 1024, orderIndex: 1,
        });
        const link = await ResourceModel.create({
            lessonId: lesson._id, title: 'Docs', type: ResourceType.Link,
            externalLink: 'https://example.com/docs', orderIndex: 2,
        });

        expect(file._id).toBeDefined();
        expect(file.lessonId?.toString()).toBe(lesson._id.toString());
        expect(link.externalLink).toBe('https://example.com/docs');
    });

    it('creates a module-level resource', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);

        const res = await ResourceModel.create({
            moduleId: mod._id, title: 'Module guide', type: ResourceType.Document, orderIndex: 1,
        });

        expect(res.moduleId?.toString()).toBe(mod._id.toString());
    });

    it('requires title, type, and orderIndex', async () => {
        await expect(
            ResourceModel.create({ title: 'no-type-no-order' } as any)
        ).rejects.toThrow();
    });

    it('rejects an unknown resource type', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(mod._id, 1);

        await expect(
            ResourceModel.create({ lessonId: lesson._id, title: 'Bad', type: 'video', orderIndex: 1 })
        ).rejects.toThrow();
    });

    it('lists resources sorted by orderIndex', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(mod._id, 1);
        await ResourceModel.create([
            { lessonId: lesson._id, title: 'Second', type: ResourceType.Link, orderIndex: 2 },
            { lessonId: lesson._id, title: 'First', type: ResourceType.Link, orderIndex: 1 },
        ]);

        const resources = await ResourceModel.find({ lessonId: lesson._id }).sort({ orderIndex: 1 }).lean();

        expect(resources).toHaveLength(2);
        expect(resources[0].title).toBe('First');
        expect(resources[1].title).toBe('Second');
    });

    it('isolates resources between lessons', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lessonA = await buildLesson(mod._id, 1);
        const lessonB = await buildLesson(mod._id, 2);
        await ResourceModel.create({ lessonId: lessonA._id, title: 'Only A', type: ResourceType.Link, orderIndex: 1 });

        const forB = await ResourceModel.find({ lessonId: lessonB._id }).lean();

        expect(forB).toEqual([]);
    });
});

describe('ContentService resource access — scoping and locking', () => {
    it('getLessonDetails returns lesson resources sorted by orderIndex', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(mod._id, 1);
        await ResourceModel.create([
            { lessonId: lesson._id, title: 'R2', type: ResourceType.Link, orderIndex: 2 },
            { lessonId: lesson._id, title: 'R1', type: ResourceType.File, orderIndex: 1 },
        ]);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await createModuleProgress(enrollment._id, mod._id, { status: ProgressStatus.Unlocked });

        const result = await ContentService.getLessonDetails(
            enrollment._id.toString(), mod._id.toString(), lesson._id.toString()
        );

        expect(result.lesson._id.toString()).toBe(lesson._id.toString());
        expect(result.resources).toHaveLength(2);
        expect(result.resources[0].title).toBe('R1');
        expect(result.resources[1].title).toBe('R2');
    });

    it('getLessonDetails rejects a lesson from another module', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);
        const otherLesson = await buildLesson(m2._id, 1);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await createModuleProgress(enrollment._id, m1._id, { status: ProgressStatus.Unlocked });

        await expect(
            ContentService.getLessonDetails(enrollment._id.toString(), m1._id.toString(), otherLesson._id.toString())
        ).rejects.toThrow(/not found in this module/i);
    });

    it('getLessonDetails forbids locked modules', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(mod._id, 1);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await createModuleProgress(enrollment._id, mod._id, { status: ProgressStatus.Locked });

        await expect(
            ContentService.getLessonDetails(enrollment._id.toString(), mod._id.toString(), lesson._id.toString())
        ).rejects.toThrow(/locked/i);
    });

    it('getModuleResources returns only module-level resources, sorted', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const lesson = await buildLesson(mod._id, 1);
        await ResourceModel.create({ lessonId: lesson._id, title: 'Lesson-only', type: ResourceType.Link, orderIndex: 1 });
        await ResourceModel.create([
            { moduleId: mod._id, title: 'M2', type: ResourceType.Document, orderIndex: 2 },
            { moduleId: mod._id, title: 'M1', type: ResourceType.Document, orderIndex: 1 },
        ]);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await createModuleProgress(enrollment._id, mod._id, { status: ProgressStatus.Unlocked });

        const resources = await ContentService.getModuleResources(enrollment._id.toString(), mod._id.toString());

        expect(resources).toHaveLength(2);
        expect(resources[0].title).toBe('M1');
        expect(resources[1].title).toBe('M2');
    });

    it('getModuleResources forbids locked modules', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await createModuleProgress(enrollment._id, mod._id, { status: ProgressStatus.Locked });

        await expect(
            ContentService.getModuleResources(enrollment._id.toString(), mod._id.toString())
        ).rejects.toThrow(/locked/i);
    });
});
