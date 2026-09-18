import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createAdmin,
    createCourse,
    createBatch,
    createModule,
} from '../helpers/factories.js';
import { ModuleService } from '../../modules/Module/module.service.js';
import { ModuleModel } from '../../modules/Module/module.model.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { LessonType } from '../../types/common.js';

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('ModuleService.createModule', () => {
    it('creates a module with an explicit orderIndex', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const mod = await ModuleService.createModule(course._id.toString(), batch._id.toString(), {
            title: 'Intro',
            description: 'Intro desc',
            orderIndex: 1,
            estimatedDuration: '1 hour',
        });

        expect(mod.title).toBe('Intro');
        expect(mod.orderIndex).toBe(1);
        expect(mod.courseId.toString()).toBe(course._id.toString());
        expect(mod.batchId.toString()).toBe(batch._id.toString());
    });

    it('auto-assigns orderIndex starting at 0, then increments', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const first = await ModuleService.createModule(course._id.toString(), batch._id.toString(), {
            title: 'First', description: 'd', estimatedDuration: '1h',
        });
        const second = await ModuleService.createModule(course._id.toString(), batch._id.toString(), {
            title: 'Second', description: 'd', estimatedDuration: '1h',
        });

        expect(first.orderIndex).toBe(0);
        expect(second.orderIndex).toBe(1);
    });

    it('rejects duplicate orderIndex within the same batch scope', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createModule(course._id, batch._id, 1);

        await expect(
            ModuleService.createModule(course._id.toString(), batch._id.toString(), {
                title: 'Dup', description: 'd', estimatedDuration: '1h', orderIndex: 1,
            })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('allows the same orderIndex in a different batch', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batchA = await createBatch(course._id);
        const batchB = await createBatch(course._id, { batchNumber: 2, title: 'Batch 2' });
        await createModule(course._id, batchA._id, 1);

        const mod = await ModuleService.createModule(course._id.toString(), batchB._id.toString(), {
            title: 'Same idx other batch', description: 'd', estimatedDuration: '1h', orderIndex: 1,
        });

        expect(mod.orderIndex).toBe(1);
    });

    it('rejects creation without a batchId', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        await expect(
            ModuleService.createModule(course._id.toString(), '', {
                title: 'No batch', description: 'd', estimatedDuration: '1h',
            })
        ).rejects.toThrow(/Batch ID is required/i);
    });
});

describe('ModuleService.getCourseModules', () => {
    it('returns modules sorted by orderIndex with lessonCount', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 2);
        const m2 = await createModule(course._id, batch._id, 1);
        await LessonModel.create([
            { moduleId: m1._id, title: 'L1', type: LessonType.Video, orderIndex: 0 },
            { moduleId: m1._id, title: 'L2', type: LessonType.Reading, orderIndex: 1 },
        ]);

        const modules = await ModuleService.getCourseModules(course._id.toString(), batch._id.toString());

        expect(modules).toHaveLength(2);
        expect(modules[0]._id.toString()).toBe(m2._id.toString());
        expect(modules[0]).toHaveProperty('lessonCount', 0);
        expect(modules[1]).toHaveProperty('lessonCount', 2);
    });

    it('scopes modules to the given batch only', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batchA = await createBatch(course._id);
        const batchB = await createBatch(course._id, { batchNumber: 2, title: 'Batch 2' });
        await createModule(course._id, batchA._id, 1);
        await createModule(course._id, batchB._id, 1);
        await createModule(course._id, batchB._id, 2);

        const modules = await ModuleService.getCourseModules(course._id.toString(), batchB._id.toString());

        expect(modules).toHaveLength(2);
    });

    it('filters by status when provided', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createModule(course._id, batch._id, 1, { status: 'published' });
        await createModule(course._id, batch._id, 2, { status: 'draft' });

        const published = await ModuleService.getCourseModules(course._id.toString(), batch._id.toString(), 'published');

        expect(published).toHaveLength(1);
        expect(published[0].orderIndex).toBe(1);
    });
});

describe('ModuleService.getModuleById', () => {
    it('returns a module with lessonCount', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        await LessonModel.create({ moduleId: mod._id, title: 'L', type: LessonType.Video, orderIndex: 0 });

        const found = await ModuleService.getModuleById(mod._id.toString());

        expect(found._id.toString()).toBe(mod._id.toString());
        expect(found).toHaveProperty('lessonCount', 1);
    });

    it('throws NOT_FOUND for a nonexistent module', async () => {
        await expect(
            ModuleService.getModuleById(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/Module not found/i);
    });
});

describe('ModuleService.updateModule', () => {
    it('updates module fields', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);

        const updated = await ModuleService.updateModule(mod._id.toString(), { title: 'Renamed' });

        expect(updated.title).toBe('Renamed');
    });

    it('rejects changing the batch of a module', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batchA = await createBatch(course._id);
        const batchB = await createBatch(course._id, { batchNumber: 2, title: 'Batch 2' });
        const mod = await createModule(course._id, batchA._id, 1);

        await expect(
            ModuleService.updateModule(mod._id.toString(), { batchId: batchB._id.toString() })
        ).rejects.toThrow(/Batch cannot be changed/i);
    });

    it('rejects conflicting orderIndex', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);

        await expect(
            ModuleService.updateModule(m1._id.toString(), { orderIndex: 2 })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('throws NOT_FOUND for a nonexistent module', async () => {
        await expect(
            ModuleService.updateModule(new mongoose.Types.ObjectId().toString(), { title: 'X' })
        ).rejects.toThrow(/Module not found/i);
    });
});

describe('ModuleService.deleteModule', () => {
    it('deletes a module with no lessons', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);

        const result = await ModuleService.deleteModule(mod._id.toString());

        expect(result).toBeNull();
        expect(await ModuleModel.findById(mod._id)).toBeNull();
    });

    it('refuses to delete a module that still has lessons', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const mod = await createModule(course._id, batch._id, 1);
        await LessonModel.create({ moduleId: mod._id, title: 'L', type: LessonType.Video, orderIndex: 0 });

        await expect(ModuleService.deleteModule(mod._id.toString())).rejects.toThrow(/existing lessons/i);
        expect(await ModuleModel.findById(mod._id)).not.toBeNull();
    });

    it('throws NOT_FOUND for a nonexistent module', async () => {
        await expect(
            ModuleService.deleteModule(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/Module not found/i);
    });
});

describe('ModuleService.reorderModules', () => {
    it('updates order indexes and returns sorted modules', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);

        const modules = await ModuleService.reorderModules(course._id.toString(), batch._id.toString(), [
            { moduleId: m1._id.toString(), orderIndex: 2 },
            { moduleId: m2._id.toString(), orderIndex: 1 },
        ]);

        expect(modules).toHaveLength(2);
        expect(modules[0]._id.toString()).toBe(m2._id.toString());
        expect(modules[1]._id.toString()).toBe(m1._id.toString());
    });

    it('throws BAD_REQUEST for non-array input', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        await expect(
            (ModuleService.reorderModules as any)(course._id.toString(), batch._id.toString(), 'nope')
        ).rejects.toThrow(/must be an array/i);
    });

    it('rejects modules that do not belong to this course/batch', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const otherBatch = await createBatch(course._id, { batchNumber: 99 });
        const foreign = await createModule(course._id, otherBatch._id, 1);

        await expect(
            ModuleService.reorderModules(course._id.toString(), batch._id.toString(), [
                { moduleId: foreign._id.toString(), orderIndex: 1 },
            ])
        ).rejects.toThrow(/must belong to this course and batch/i);
    });

    it('rejects duplicate orderIndex values in one payload', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);

        await expect(
            ModuleService.reorderModules(course._id.toString(), batch._id.toString(), [
                { moduleId: m1._id.toString(), orderIndex: 1 },
                { moduleId: m2._id.toString(), orderIndex: 1 },
            ])
        ).rejects.toThrow(/duplicate orderindex/i);
    });
});

describe('ModuleService.getUnassignedCourseModules', () => {
    it('returns empty when every module has a batch', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createModule(course._id, batch._id, 1);

        const unassigned = await ModuleService.getUnassignedCourseModules(course._id.toString());

        expect(unassigned).toEqual([]);
    });

    it('returns modules with a null batchId (inserted without validation)', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createModule(course._id, batch._id, 1);
        // batchId is required by the schema, so bypass validation to simulate legacy rows
        await ModuleModel.collection.insertOne({
            courseId: course._id,
            batchId: null,
            title: 'Legacy',
            description: 'legacy desc',
            orderIndex: 0,
            estimatedDuration: '1h',
        });

        const unassigned = await ModuleService.getUnassignedCourseModules(course._id.toString());

        expect(unassigned).toHaveLength(1);
        expect(unassigned[0].title).toBe('Legacy');
    });
});
