import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createActiveEnrollment,
} from '../helpers/factories.js';
import { RecordingService } from '../../modules/Recording/recording.service.js';
import { RecordingModel } from '../../modules/Recording/recording.model.js';


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

describe('RecordingService.createRecording', () => {
    it('creates a recording with YouTube videoUrl', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const recording = await RecordingService.createRecording(
            {
                courseId: course._id,
                batchId: batch._id,
                title: 'Test Recording',
                sessionDate: new Date(),
                videoSource: 'youtube',
                videoId: 'abc123',
                isPublished: false,
            },
            user._id.toString()
        );

        expect(recording.title).toBe('Test Recording');
        expect(recording.videoUrl).toBe('https://www.youtube.com/embed/abc123');
        expect(recording.createdBy.toString()).toBe(user._id.toString());
    });

    it('creates a recording with GoogleDrive videoUrl', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const recording = await RecordingService.createRecording(
            {
                courseId: course._id,
                batchId: batch._id,
                title: 'Drive Recording',
                sessionDate: new Date(),
                videoSource: 'googledrive',
                videoId: 'xyz789',
                isPublished: false,
            },
            user._id.toString()
        );

        expect(recording.videoUrl).toBe('https://drive.google.com/file/d/xyz789/preview');
    });

    it('sets createdBy and default isPublished', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const recording = await RecordingService.createRecording(
            {
                courseId: course._id,
                batchId: batch._id,
                title: 'Default Draft',
                sessionDate: new Date(),
                videoSource: 'youtube',
                videoId: 'test',
            },
            user._id.toString()
        );

        expect(recording.createdBy.toString()).toBe(user._id.toString());
        expect(recording.isPublished).toBe(false);
    });
});

describe('RecordingService.getAllRecordings', () => {
    it('returns paginated recordings', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        await RecordingModel.create([
            {
                courseId: course._id, batchId: batch._id, title: 'R1',
                sessionDate: new Date(), videoSource: 'youtube', videoId: '1',
                createdBy: user._id, isPublished: true,
            },
            {
                courseId: course._id, batchId: batch._id, title: 'R2',
                sessionDate: new Date(), videoSource: 'youtube', videoId: '2',
                createdBy: user._id, isPublished: true,
            },
        ]);

        const result = await RecordingService.getAllRecordings({ page: 1, limit: 10 });
        expect(result.data).toHaveLength(2);
        expect(result.meta.total).toBe(2);
    });

    it('filters by courseId', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course1 = await createCourse(admin._id, { slug: 'c1' });
        const course2 = await createCourse(admin._id, { slug: 'c2' });
        const batch1 = await createBatch(course1._id);
        const batch2 = await createBatch(course2._id);

        await RecordingModel.create({
            courseId: course1._id, batchId: batch1._id, title: 'R1',
            sessionDate: new Date(), videoSource: 'youtube', videoId: '1',
            createdBy: user._id, isPublished: true,
        });
        await RecordingModel.create({
            courseId: course2._id, batchId: batch2._id, title: 'R2',
            sessionDate: new Date(), videoSource: 'youtube', videoId: '2',
            createdBy: user._id, isPublished: true,
        });

        const result = await RecordingService.getAllRecordings({ courseId: course1._id.toString(), page: 1, limit: 10 });
        expect(result.data).toHaveLength(1);
        expect(result.data[0].title).toBe('R1');
    });

    it('filters by batchId', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course1 = await createCourse(admin._id, { slug: 'course-a' });
        const course2 = await createCourse(admin._id, { slug: 'course-b' });
        const batch1 = await createBatch(course1._id, { title: 'Batch 1' });
        const batch2 = await createBatch(course2._id, { title: 'Batch 2' });

        await RecordingModel.create({
            courseId: course1._id, batchId: batch1._id, title: 'R1',
            sessionDate: new Date(), videoSource: 'youtube', videoId: '1',
            createdBy: user._id, isPublished: true,
        });
        await RecordingModel.create({
            courseId: course2._id, batchId: batch2._id, title: 'R2',
            sessionDate: new Date(), videoSource: 'youtube', videoId: '2',
            createdBy: user._id, isPublished: true,
        });

        const result = await RecordingService.getAllRecordings({ batchId: batch1._id.toString(), page: 1, limit: 10 });
        expect(result.data).toHaveLength(1);
        expect(result.data[0].title).toBe('R1');
    });
});

describe('RecordingService.getRecordingById', () => {
    it('returns a populated recording', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const created = await RecordingModel.create({
            courseId: course._id, batchId: batch._id, title: 'My Recording',
            sessionDate: new Date(), videoSource: 'youtube', videoId: 'vid',
            createdBy: user._id, isPublished: true,
        });

        const recording = await RecordingService.getRecordingById(created._id.toString());
        expect(recording._id!.toString()).toBe(created._id!.toString());
        expect(recording.title).toBe('My Recording');
    });

    it('throws when recording is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        await expect(RecordingService.getRecordingById(fakeId)).rejects.toThrow(/Recording not found/i);
    });
});

describe('RecordingService.getBatchRecordings', () => {
    it('returns published recordings for a batch', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        await RecordingModel.create([
            {
                courseId: course._id, batchId: batch._id, title: 'Published',
                sessionDate: new Date(), videoSource: 'youtube', videoId: '1',
                createdBy: user._id, isPublished: true,
            },
            {
                courseId: course._id, batchId: batch._id, title: 'Draft',
                sessionDate: new Date(), videoSource: 'youtube', videoId: '2',
                createdBy: user._id, isPublished: false,
            },
        ]);

        const recordings = await RecordingService.getBatchRecordings(batch._id.toString());
        expect(recordings).toHaveLength(1);
        expect(recordings[0].title).toBe('Published');
    });
});

describe('RecordingService.getStudentRecordings', () => {
    it('returns recordings for user active enrollments', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        await createActiveEnrollment(user._id, batch._id);

        await RecordingModel.create({
            courseId: course._id, batchId: batch._id, title: 'For Students',
            sessionDate: new Date(), videoSource: 'youtube', videoId: '1',
            createdBy: user._id, isPublished: true,
        });

        const recordings = await RecordingService.getStudentRecordings(user._id.toString());
        expect(recordings.length).toBeGreaterThanOrEqual(1);
        expect(recordings.some((r: any) => r.title === 'For Students')).toBe(true);
    });

    it('returns empty when user has no enrollments', async () => {
        const user = await createUser();
        const recordings = await RecordingService.getStudentRecordings(user._id.toString());
        expect(recordings).toEqual([]);
    });
});

describe('RecordingService.updateRecording', () => {
    it('updates recording fields', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const created = await RecordingModel.create({
            courseId: course._id, batchId: batch._id, title: 'Old',
            sessionDate: new Date(), videoSource: 'youtube', videoId: 'x',
            createdBy: user._id, isPublished: false,
        });

        const updated = await RecordingService.updateRecording(created._id.toString(), { title: 'New Title' });
        expect(updated.title).toBe('New Title');
    });

    it('updates videoUrl when source changes', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const created = await RecordingModel.create({
            courseId: course._id, batchId: batch._id, title: 'Test',
            sessionDate: new Date(), videoSource: 'youtube', videoId: 'old',
            videoUrl: 'https://www.youtube.com/embed/old',
            createdBy: user._id, isPublished: false,
        });

        const updated = await RecordingService.updateRecording(created._id.toString(), {
            videoSource: 'googledrive',
            videoId: 'newdriveid',
        });

        expect(updated.videoUrl).toBe('https://drive.google.com/file/d/newdriveid/preview');
    });

    it('throws when recording is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        await expect(
            RecordingService.updateRecording(fakeId, { title: 'Nope' })
        ).rejects.toThrow(/Recording not found/i);
    });
});

describe('RecordingService.deleteRecording', () => {
    it('deletes an existing recording', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const created = await RecordingModel.create({
            courseId: course._id, batchId: batch._id, title: 'Delete Me',
            sessionDate: new Date(), videoSource: 'youtube', videoId: 'x',
            createdBy: user._id, isPublished: false,
        });

        await RecordingService.deleteRecording(created._id.toString());
        const found = await RecordingModel.findById(created._id);
        expect(found).toBeNull();
    });

    it('throws when recording is not found', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        await expect(RecordingService.deleteRecording(fakeId)).rejects.toThrow(/Recording not found/i);
    });
});

describe('RecordingService.incrementViewCount', () => {
    it('increments view count by 1', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);

        const created = await RecordingModel.create({
            courseId: course._id, batchId: batch._id, title: 'Viral',
            sessionDate: new Date(), videoSource: 'youtube', videoId: 'x',
            createdBy: user._id, isPublished: true,
        });

        await RecordingService.incrementViewCount(created._id.toString());
        const updated = await RecordingModel.findById(created._id);
        expect(updated?.viewCount).toBe(1);

        await RecordingService.incrementViewCount(created._id.toString());
        const updated2 = await RecordingModel.findById(created._id);
        expect(updated2?.viewCount).toBe(2);
    });
});
