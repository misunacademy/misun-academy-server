import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createAdmin, createCourse, createUser, createActiveEnrollment } from '../helpers/factories.js';
import { BatchService } from '../../modules/Batch/batch.service.js';
import { BatchModel } from '../../modules/Batch/batch.model.js';
import { BatchStatus } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const day = 24 * 60 * 60 * 1000;

const buildBatchPayload = (courseId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) => ({
    courseId,
    title: `Batch ${uniq()}`,
    startDate: new Date(Date.now() + 30 * day),
    endDate: new Date(Date.now() + 120 * day),
    enrollmentStartDate: new Date(Date.now() - day),
    enrollmentEndDate: new Date(Date.now() + 20 * day),
    price: 5000,
    ...overrides,
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

describe('BatchService.createBatch', () => {
    it('creates a batch with auto-generated batchNumber starting at 1', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        const batch = await BatchService.createBatch(buildBatchPayload(course._id));

        expect(batch.batchNumber).toBe(1);
        expect(batch.currentEnrollment).toBe(0);
        expect(batch.status).toBe(BatchStatus.Draft);
    });

    it('increments batchNumber for subsequent batches of the same course', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        const first = await BatchService.createBatch(buildBatchPayload(course._id));
        const second = await BatchService.createBatch(buildBatchPayload(course._id));

        expect(first.batchNumber).toBe(1);
        expect(second.batchNumber).toBe(2);
    });

    it('starts numbering at 1 for a different course', async () => {
        const admin = await createAdmin();
        const courseA = await createCourse(admin._id, { slug: `ca-${uniq()}` });
        const courseB = await createCourse(admin._id, { slug: `cb-${uniq()}` });
        await BatchService.createBatch(buildBatchPayload(courseA._id));

        const batchB = await BatchService.createBatch(buildBatchPayload(courseB._id));

        expect(batchB.batchNumber).toBe(1);
    });

    it('rejects creation without a courseId', async () => {
        await expect(
            BatchService.createBatch({ title: 'No course' } as any)
        ).rejects.toThrow(/Course ID is required/i);
    });

    it('rejects endDate before startDate', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        await expect(
            BatchService.createBatch(buildBatchPayload(course._id, {
                startDate: new Date(Date.now() + 60 * day),
                endDate: new Date(Date.now() + 30 * day),
            }))
        ).rejects.toThrow(/End date must be after start date/i);
    });

    it('rejects enrollmentEndDate before enrollmentStartDate', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        await expect(
            BatchService.createBatch(buildBatchPayload(course._id, {
                enrollmentStartDate: new Date(Date.now() + 10 * day),
                enrollmentEndDate: new Date(Date.now() - day),
            }))
        ).rejects.toThrow(/Enrollment end date must be after enrollment start date/i);
    });
});

describe('BatchService.getAllBatches / getUpcomingBatches', () => {
    it('paginates batches with meta', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        await BatchService.createBatch(buildBatchPayload(course._id));
        await BatchService.createBatch(buildBatchPayload(course._id));
        await BatchService.createBatch(buildBatchPayload(course._id));

        const result = await BatchService.getAllBatches({ page: 1, limit: 2 });

        expect(result.data).toHaveLength(2);
        expect(result.meta.total).toBe(3);
        expect(result.meta.totalPages).toBe(2);
    });

    it('filters by status and courseId', async () => {
        const admin = await createAdmin();
        const courseA = await createCourse(admin._id, { slug: `fa-${uniq()}` });
        const courseB = await createCourse(admin._id, { slug: `fb-${uniq()}` });
        await BatchService.createBatch(buildBatchPayload(courseA._id, { status: BatchStatus.Upcoming }));
        await BatchService.createBatch(buildBatchPayload(courseB._id, { status: BatchStatus.Upcoming }));

        const byStatus = await BatchService.getAllBatches({ status: BatchStatus.Upcoming });
        expect(byStatus.meta.total).toBe(2);

        const byCourse = await BatchService.getAllBatches({ courseId: courseA._id.toString() });
        expect(byCourse.meta.total).toBe(1);
    });

    it('upcoming flag matches Upcoming and Running batches', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        await BatchService.createBatch(buildBatchPayload(course._id, { status: BatchStatus.Upcoming }));
        await BatchService.createBatch(buildBatchPayload(course._id, { status: BatchStatus.Running }));

        const result = await BatchService.getAllBatches({ upcoming: true });

        expect(result.meta.total).toBe(2);
    });
});

describe('BatchService.getCurrentEnrollmentBatch(es)', () => {
    it('returns the open upcoming batch for a course', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const open = await BatchService.createBatch(buildBatchPayload(course._id, { status: BatchStatus.Upcoming }));

        const found = await BatchService.getCurrentEnrollmentBatch(course._id.toString());

        expect(found?._id.toString()).toBe(open._id.toString());
    });

    it('ignores expired, hidden, and non-upcoming batches', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        await BatchService.createBatch(buildBatchPayload(course._id, {
            status: BatchStatus.Upcoming,
            enrollmentStartDate: new Date(Date.now() - 30 * day),
            enrollmentEndDate: new Date(Date.now() - day),
        }));
        await BatchService.createBatch(buildBatchPayload(course._id, {
            status: BatchStatus.Running,
        }));

        const found = await BatchService.getCurrentEnrollmentBatch(course._id.toString());

        expect(found).toBeNull();
    });

    it('getCurrentEnrollmentBatchesForCourses lists open batches across courses', async () => {
        const admin = await createAdmin();
        const courseA = await createCourse(admin._id, { slug: `ga-${uniq()}` });
        const courseB = await createCourse(admin._id, { slug: `gb-${uniq()}` });
        await BatchService.createBatch(buildBatchPayload(courseA._id, { status: BatchStatus.Upcoming }));
        await BatchService.createBatch(buildBatchPayload(courseB._id, { status: BatchStatus.Upcoming }));
        await BatchService.createBatch(buildBatchPayload(courseB._id, {
            status: BatchStatus.Upcoming, isHidden: true,
            enrollmentEndDate: new Date(Date.now() + 30 * day),
        }));

        const batches = await BatchService.getCurrentEnrollmentBatchesForCourses();

        // hidden batch excluded
        expect(batches).toHaveLength(2);
    });
});

describe('BatchService.getBatchById / updateBatch', () => {
    it('returns a batch by id with populated course', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id));

        const found = await BatchService.getBatchById(batch._id.toString());

        expect(found._id.toString()).toBe(batch._id.toString());
        expect((found.courseId as any).title).toBe(course.title);
    });

    it('throws NOT_FOUND for a nonexistent batch', async () => {
        await expect(
            BatchService.getBatchById(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/Batch not found/i);
    });

    it('updates batch fields', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id));

        const updated = await BatchService.updateBatch(batch._id.toString(), { title: 'Renamed batch', price: 7000 });

        expect(updated?.title).toBe('Renamed batch');
        expect(updated?.price).toBe(7000);
    });

    it('rejects an update that inverts start/end dates', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id));

        await expect(
            BatchService.updateBatch(batch._id.toString(), {
                startDate: new Date(Date.now() + 200 * day),
                endDate: new Date(Date.now() + 100 * day),
            } as any)
        ).rejects.toThrow(/End date must be after start date/i);
    });

    it('rejects an update that inverts enrollment dates', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id));

        await expect(
            BatchService.updateBatch(batch._id.toString(), {
                enrollmentStartDate: new Date(Date.now() + 20 * day),
                enrollmentEndDate: new Date(Date.now() + 10 * day),
            } as any)
        ).rejects.toThrow(/Enrollment end date must be after enrollment start date/i);
    });

    it('throws NOT_FOUND when updating a nonexistent batch', async () => {
        await expect(
            BatchService.updateBatch(new mongoose.Types.ObjectId().toString(), { title: 'X' })
        ).rejects.toThrow(/Batch not found/i);
    });
});

describe('BatchService.transitionBatchStatus / deleteBatch', () => {
    it('transitions batch status', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id, { status: BatchStatus.Upcoming }));

        const transitioned = await BatchService.transitionBatchStatus(batch._id.toString(), BatchStatus.Running);

        expect(transitioned.status).toBe(BatchStatus.Running);
        const fromDb = await BatchModel.findById(batch._id).lean();
        expect(fromDb?.status).toBe(BatchStatus.Running);
    });

    it('throws NOT_FOUND when transitioning a nonexistent batch', async () => {
        await expect(
            BatchService.transitionBatchStatus(new mongoose.Types.ObjectId().toString(), BatchStatus.Running)
        ).rejects.toThrow(/Batch not found/i);
    });

    it('deletes a batch', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id));

        const result = await BatchService.deleteBatch(batch._id.toString());

        expect(result.message).toMatch(/deleted/i);
        expect(await BatchModel.findById(batch._id)).toBeNull();
    });

    it('throws NOT_FOUND when deleting a nonexistent batch', async () => {
        await expect(
            BatchService.deleteBatch(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/Batch not found/i);
    });

    it('refuses to delete a batch that has enrollments', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await BatchService.createBatch(buildBatchPayload(course._id));
        await createActiveEnrollment(user._id, batch._id);

        await expect(BatchService.deleteBatch(batch._id.toString())).rejects.toThrow(
            /existing enrollments/i
        );
        expect(await BatchModel.findById(batch._id)).not.toBeNull();
    });
});
