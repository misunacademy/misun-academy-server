import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createModule,
    createEnrollment,
} from '../helpers/factories.js';
import { CourseService } from '../../modules/Course/course.service.js';
import { CourseModel } from '../../modules/Course/course.model.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { QuizModel } from '../../modules/Quiz/quiz.model.js';
import { CourseLevel, EnrollmentStatus, LessonType } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildCoursePayload = (adminId: mongoose.Types.ObjectId) => ({
    title: `Course ${uniq()}`,
    slug: `course-${uniq()}`,
    shortDescription: 'A short description',
    fullDescription: 'A full description',
    learningOutcomes: ['Learn X'],
    targetAudience: 'Beginners',
    thumbnailImage: 'https://example.com/thumb.jpg',
    durationEstimate: '10 hours',
    level: CourseLevel.Beginner,
    category: 'Programming',
    createdBy: adminId,
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

describe('CourseService.createCourse', () => {
    it('creates a course with an explicit slug', async () => {
        const admin = await createAdmin();
        const payload = buildCoursePayload(admin._id);

        const course = await CourseService.createCourse(payload);

        expect(course._id).toBeDefined();
        expect(course.slug).toBe(payload.slug);
        expect(course.title).toBe(payload.title);
    });

    it('auto-generates a slug from the title when slug is missing', async () => {
        const admin = await createAdmin();
        const payload = buildCoursePayload(admin._id);
        const { slug: _omit, ...noSlug } = payload;

        const course = await CourseService.createCourse({ ...noSlug, title: 'My Great Course XYZ' });

        expect(course.slug).toBe('my-great-course-xyz');
    });

    it('rejects duplicate slugs (unique index)', async () => {
        const admin = await createAdmin();
        const slug = `dup-${uniq()}`;
        await CourseService.createCourse({ ...buildCoursePayload(admin._id), slug });
        await expect(
            CourseService.createCourse({ ...buildCoursePayload(admin._id), slug })
        ).rejects.toThrow();
    });
});

describe('CourseService.getCourses', () => {
    it('returns paginated courses with meta', async () => {
        const admin = await createAdmin();
        await createCourse(admin._id, { slug: `c1-${uniq()}` });
        await createCourse(admin._id, { slug: `c2-${uniq()}` });
        await createCourse(admin._id, { slug: `c3-${uniq()}` });

        const result = await CourseService.getCourses({}, { page: 1, perPage: 2 });

        expect(result.data).toHaveLength(2);
        expect(result.meta.total).toBe(3);
        expect(result.meta.totalPages).toBe(2);
        expect(result.meta.page).toBe(1);
        expect(result.meta.limit).toBe(2);
    });

    it('filters by status and includes studentsCount field', async () => {
        const admin = await createAdmin();
        await createCourse(admin._id, { slug: `pub-${uniq()}`, status: 'published' });
        await createCourse(admin._id, { slug: `drf-${uniq()}`, status: 'draft' });

        const result = await CourseService.getCourses({ status: 'published' });

        expect(result.meta.total).toBe(1);
        expect(result.data[0]).toHaveProperty('studentsCount');
    });
});

describe('CourseService.getCourseById — curriculum assembly', () => {
    it('assembles modules with sorted lessons and published quizzes only', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);

        await LessonModel.create([
            { moduleId: m1._id, title: 'B-lesson', type: LessonType.Video, orderIndex: 2, videoSource: 'youtube', videoId: 'vidB', videoDuration: 100 },
            { moduleId: m1._id, title: 'A-lesson', type: LessonType.Reading, orderIndex: 1 },
        ]);
        await QuizModel.create([
            { moduleId: m1._id, title: 'Published Quiz', slug: `pq-${uniq()}`, orderIndex: 1, status: 'published', createdBy: admin._id },
            { moduleId: m1._id, title: 'Draft Quiz', slug: `dq-${uniq()}`, orderIndex: 2, status: 'draft', createdBy: admin._id },
        ]);
        await LessonModel.create({ moduleId: m2._id, title: 'M2 lesson', type: LessonType.Video, orderIndex: 1 });

        const result = await CourseService.getCourseById(course._id.toString());

        expect(result).not.toBeNull();
        expect(result?.curriculum).toHaveLength(2);
        // modules sorted by orderIndex
        expect(result?.curriculum[0].title).toBe(m1.title);
        // lessons sorted by orderIndex
        expect(result?.curriculum[0].lessons).toHaveLength(2);
        expect(result?.curriculum[0].lessons[0].title).toBe('A-lesson');
        expect(result?.curriculum[0].lessons[1].title).toBe('B-lesson');
        // only published quizzes
        expect(result?.curriculum[0].quizzes).toHaveLength(1);
        expect(result?.curriculum[0].quizzes[0].title).toBe('Published Quiz');
        expect(result?.curriculum[1].lessons).toHaveLength(1);
    });

    it('builds a watch URL for youtube lessons missing videoUrl', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        await LessonModel.create({
            moduleId: m1._id, title: 'YT', type: LessonType.Video, orderIndex: 1,
            videoSource: 'youtube', videoId: 'abc123XYZ', videoDuration: 600,
        });

        const result = await CourseService.getCourseById(course._id.toString());
        const media = result?.curriculum[0].lessons[0].media;

        expect(media).not.toBeNull();
        expect(media?.url).toContain('abc123XYZ');
    });

    it('scopes curriculum by batchId when provided', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batchA = await createBatch(course._id);
        const batchB = await createBatch(course._id, { batchNumber: 2, title: 'Batch 2' });
        await createModule(course._id, batchA._id, 1);
        await createModule(course._id, batchB._id, 1);
        await createModule(course._id, batchB._id, 2);

        const scoped = await CourseService.getCourseById(course._id.toString(), { batchId: batchB._id.toString() });
        const unscoped = await CourseService.getCourseById(course._id.toString());

        expect(scoped?.curriculum).toHaveLength(2);
        expect(unscoped?.curriculum).toHaveLength(3);
    });

    it('returns null for a nonexistent course', async () => {
        const result = await CourseService.getCourseById(new mongoose.Types.ObjectId().toString());
        expect(result).toBeNull();
    });
});

describe('CourseService.getCourseBySlug / updateCourse / deleteCourse', () => {
    it('finds a course by slug', async () => {
        const admin = await createAdmin();
        const slug = `findme-${uniq()}`;
        await createCourse(admin._id, { slug });

        const found = await CourseService.getCourseBySlug(slug);
        expect(found?.slug).toBe(slug);

        const missing = await CourseService.getCourseBySlug(`nope-${uniq()}`);
        expect(missing).toBeNull();
    });

    it('updates course fields', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        const updated = await CourseService.updateCourse(course._id.toString(), { title: 'Renamed' });

        expect(updated?.title).toBe('Renamed');
        const fromDb = await CourseModel.findById(course._id).lean();
        expect(fromDb?.title).toBe('Renamed');
    });

    it('returns null when updating a nonexistent course', async () => {
        const updated = await CourseService.updateCourse(new mongoose.Types.ObjectId().toString(), { title: 'X' });
        expect(updated).toBeNull();
    });

    it('deletes a course', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        await CourseService.deleteCourse(course._id.toString());

        expect(await CourseModel.findById(course._id)).toBeNull();
    });
});

describe('CourseService.assignInstructor', () => {
    it('assigns an instructor user to a course', async () => {
        const admin = await createAdmin();
        const instructor = await createUser({ email: `inst-${uniq()}@example.com`, role: 'instructor' });
        const course = await createCourse(admin._id);

        const updated = await CourseService.assignInstructor(course._id.toString(), instructor._id.toString());

        expect((updated?.instructorId as any)?._id.toString()).toBe(instructor._id.toString());
    });

    it('rejects assigning a non-instructor user', async () => {
        const admin = await createAdmin();
        const learner = await createUser({ email: `lrn-${uniq()}@example.com`, role: 'learner' });
        const course = await createCourse(admin._id);

        await expect(
            CourseService.assignInstructor(course._id.toString(), learner._id.toString())
        ).rejects.toThrow(/instructor/i);
    });

    it('rejects assigning a nonexistent user', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);

        await expect(
            CourseService.assignInstructor(course._id.toString(), new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/instructor/i);
    });

    it('unassigns the instructor when null is passed', async () => {
        const admin = await createAdmin();
        const instructor = await createUser({ email: `inst-${uniq()}@example.com`, role: 'instructor' });
        const course = await createCourse(admin._id);
        await CourseService.assignInstructor(course._id.toString(), instructor._id.toString());

        const updated = await CourseService.assignInstructor(course._id.toString(), null);

        expect(updated?.instructorId).toBeNull();
    });

    it('throws NOT_FOUND for a nonexistent course', async () => {
        const instructor = await createUser({ email: `inst-${uniq()}@example.com`, role: 'instructor' });

        await expect(
            CourseService.assignInstructor(new mongoose.Types.ObjectId().toString(), instructor._id.toString())
        ).rejects.toThrow(/not found/i);
    });
});

describe('CourseService.getCourses — studentsCount via batches', () => {
    it('counts enrollments through their batches, scoped per course', async () => {
        const admin = await createAdmin();
        const courseA = await createCourse(admin._id, { slug: `ca-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
        const courseB = await createCourse(admin._id, { slug: `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
        const batchA = await createBatch(courseA._id);
        const batchB = await createBatch(courseB._id, { batchNumber: 7 });
        const u1 = await createUser({ email: `u1-${Date.now()}@example.com` });
        const u2 = await createUser({ email: `u2-${Date.now()}@example.com` });
        const tag = Date.now().toString(36);
        const active = { status: EnrollmentStatus.Active, enrolledAt: new Date() };
        await createEnrollment(u1._id, batchA._id, { ...active, enrollmentId: `MA-A1-${tag}` });
        await createEnrollment(u2._id, batchA._id, { ...active, enrollmentId: `MA-A2-${tag}` });
        await createEnrollment(u2._id, batchB._id, { ...active, enrollmentId: `MA-B1-${tag}` });

        const result = await CourseService.getCourses({});
        const byId = new Map(result.data.map((c: any) => [c._id.toString(), c.studentsCount]));
        expect(byId.get((courseA._id as any).toString())).toBe(2);
        expect(byId.get((courseB._id as any).toString())).toBe(1);
    });
});
