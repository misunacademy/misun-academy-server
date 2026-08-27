import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createModule,
} from '../helpers/factories.js';
import { LessonService } from '../../modules/Lesson/lesson.service.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { LessonType } from '../../types/common.js';

import '../../modules/Instructor/instructor.model.js';

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('LessonService.createLesson', () => {
    it('creates a lesson with auto-generated orderIndex', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const lesson = await LessonService.createLesson(mod._id.toString(), {
            title: 'Test Lesson',
            type: LessonType.Video,
        });

        expect(lesson.title).toBe('Test Lesson');
        expect(lesson.moduleId.toString()).toBe(mod._id.toString());
        expect(lesson.orderIndex).toBe(0);
    });

    it('creates lesson with specified orderIndex', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const lesson = await LessonService.createLesson(mod._id.toString(), {
            title: 'Test Lesson',
            type: LessonType.Video,
            orderIndex: 5,
        });

        expect(lesson.orderIndex).toBe(5);
    });

    it('rejects duplicate orderIndex', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        await LessonService.createLesson(mod._id.toString(), {
            title: 'Lesson 1',
            type: LessonType.Video,
            orderIndex: 1,
        });

        await expect(
            LessonService.createLesson(mod._id.toString(), {
                title: 'Lesson 2',
                type: LessonType.Reading,
                orderIndex: 1,
            })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('rejects when module is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();

        await expect(
            LessonService.createLesson(fakeId, {
                title: 'Test',
                type: LessonType.Video,
            })
        ).rejects.toThrow(/Module not found/i);
    });
});

describe('LessonService.getModuleLessons', () => {
    it('returns lessons sorted by orderIndex', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        await LessonModel.create([
            { moduleId: mod._id, title: 'B', type: LessonType.Video, orderIndex: 2 },
            { moduleId: mod._id, title: 'A', type: LessonType.Reading, orderIndex: 1 },
        ]);

        const lessons = await LessonService.getModuleLessons(mod._id.toString());
        expect(lessons).toHaveLength(2);
        expect(lessons[0].title).toBe('A');
        expect(lessons[1].title).toBe('B');
    });

    it('filters by type', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        await LessonModel.create([
            { moduleId: mod._id, title: 'Vid', type: LessonType.Video, orderIndex: 0 },
            { moduleId: mod._id, title: 'Read', type: LessonType.Reading, orderIndex: 1 },
        ]);

        const lessons = await LessonService.getModuleLessons(mod._id.toString(), LessonType.Video);
        expect(lessons).toHaveLength(1);
        expect(lessons[0].title).toBe('Vid');
    });

    it('returns empty array for module with no lessons', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        const lessons = await LessonService.getModuleLessons(fakeId);
        expect(lessons).toEqual([]);
    });
});

describe('LessonService.getLessonById', () => {
    it('returns lesson with populated moduleId', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const created = await LessonModel.create({
            moduleId: mod._id,
            title: 'Test',
            type: LessonType.Video,
            orderIndex: 0,
        });

        const lesson = await LessonService.getLessonById(created._id.toString());
        expect(lesson._id.toString()).toBe(created._id.toString());
        expect((lesson.moduleId as any)._id.toString()).toBe(mod._id.toString());
    });

    it('throws when lesson is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        await expect(LessonService.getLessonById(fakeId)).rejects.toThrow(/Lesson not found/i);
    });
});

describe('LessonService.updateLesson', () => {
    it('updates lesson fields', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const created = await LessonModel.create({
            moduleId: mod._id,
            title: 'Old Title',
            type: LessonType.Video,
            orderIndex: 0,
        });

        const updated = await LessonService.updateLesson(created._id.toString(), {
            title: 'New Title',
        });

        expect(updated.title).toBe('New Title');
    });

    it('rejects duplicate orderIndex', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const lesson1 = await LessonModel.create({
            moduleId: mod._id,
            title: 'Lesson 1',
            type: LessonType.Video,
            orderIndex: 0,
        });

        await LessonModel.create({
            moduleId: mod._id,
            title: 'Lesson 2',
            type: LessonType.Reading,
            orderIndex: 1,
        });

        await expect(
            LessonService.updateLesson(lesson1._id.toString(), { orderIndex: 1 })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('throws when lesson is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        await expect(
            LessonService.updateLesson(fakeId, { title: 'Nope' })
        ).rejects.toThrow(/Lesson not found/i);
    });
});

describe('LessonService.deleteLesson', () => {
    it('deletes an existing lesson', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const created = await LessonModel.create({
            moduleId: mod._id,
            title: 'Delete Me',
            type: LessonType.Video,
            orderIndex: 0,
        });

        const result = await LessonService.deleteLesson(created._id.toString());
        expect(result).toBeNull();

        const found = await LessonModel.findById(created._id);
        expect(found).toBeNull();
    });

    it('throws when lesson is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        await expect(LessonService.deleteLesson(fakeId)).rejects.toThrow(/Lesson not found/i);
    });
});

describe('LessonService.reorderLessons', () => {
    it('updates order indexes and returns sorted lessons', async () => {
        await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 0);

        const l1 = await LessonModel.create({
            moduleId: mod._id,
            title: 'A',
            type: LessonType.Video,
            orderIndex: 0,
        });
        const l2 = await LessonModel.create({
            moduleId: mod._id,
            title: 'B',
            type: LessonType.Reading,
            orderIndex: 1,
        });

        const lessons = await LessonService.reorderLessons(mod._id.toString(), [
            { lessonId: l1._id.toString(), orderIndex: 1 },
            { lessonId: l2._id.toString(), orderIndex: 0 },
        ]);

        expect(lessons).toHaveLength(2);
        expect(lessons[0].title).toBe('B');
        expect(lessons[1].title).toBe('A');
    });

    it('throws BAD_REQUEST for non-array input', async () => {
        await expect(
            (LessonService.reorderLessons as any)('any', 'not-array')
        ).rejects.toThrow(/lessonOrders must be an array/i);
    });
});
