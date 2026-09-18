import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { ProfileService } from '../../modules/Profile/profile.service.js';
import { ProfileModel } from '../../modules/Profile/profile.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
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

const createEnrollmentWithId = async (userId: any, batchId: any, overrides: Record<string, unknown> = {}) =>
    EnrollmentModel.create({
        userId,
        batchId,
        status: EnrollmentStatus.Active,
        enrollmentId: `MA-${uniq()}`,
        enrolledAt: new Date(),
        ...overrides,
    });

describe('ProfileService.createProfile / getProfile / updateProfile / deleteProfile', () => {
    it('creates and retrieves a profile', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const created = await ProfileService.createProfile(user._id.toString(), {
            bio: 'Aspiring designer',
        } as any);
        expect(created.user.toString()).toBe(user._id.toString());

        const fetched = await ProfileService.getProfile(user._id.toString());
        expect(fetched.bio).toBe('Aspiring designer');
        expect(fetched.enrollments).toEqual([]);
    });

    it('updateProfile upserts and syncs user fields (name/phone/address/avatar->image)', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const updated: any = await ProfileService.updateProfile(user._id.toString(), {
            name: 'New Name',
            phone: '01700000000',
            avatar: 'https://example.com/a.png',
            bio: 'Updated bio',
        });

        expect(updated.bio).toBe('Updated bio');

        const { UserModel } = await import('../../modules/User/user.model.js');
        const synced = await UserModel.findById(user._id).lean();
        expect(synced?.name).toBe('New Name');
        expect(synced?.phone).toBe('01700000000');
        expect(synced?.image).toBe('https://example.com/a.png');
    });

    it('deleteProfile removes the profile', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        await ProfileService.createProfile(user._id.toString(), {} as any);
        await ProfileService.deleteProfile(user._id.toString());
        expect(await ProfileModel.countDocuments({ user: user._id })).toBe(0);
    });

    it('getProfile returns enrollment details hydrated from the Enrollment collection', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await ProfileService.createOrUpdateProfileAfterEnrollment(
            user._id.toString(),
            enrollment.enrollmentId as string
        );

        const fetched: any = await ProfileService.getProfile(user._id.toString());
        expect(fetched.enrollments).toHaveLength(1);
        // hydrated: full enrollment doc, not just the reference
        expect(fetched.enrollments[0].status).toBe(EnrollmentStatus.Active);
    });
});

describe('ProfileService interests', () => {
    it('updateInterests replaces, addInterest appends without duplicates, removeInterest pulls', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const uid = user._id.toString();

        const replaced: any = await ProfileService.updateInterests(uid, ['design', 'english']);
        expect(replaced.areasOfInterest).toEqual(expect.arrayContaining(['design', 'english']));

        const added: any = await ProfileService.addInterest(uid, 'design');
        expect(added.areasOfInterest.filter((i: string) => i === 'design')).toHaveLength(1);

        const removed: any = await ProfileService.removeInterest(uid, 'design');
        expect(removed.areasOfInterest).not.toContain('design');
        expect(removed.areasOfInterest).toContain('english');
    });
});

describe('ProfileService enrollment sync', () => {
    it('createOrUpdateProfileAfterEnrollment is idempotent (no duplicate refs)', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);
        const uid = user._id.toString();

        await ProfileService.createOrUpdateProfileAfterEnrollment(uid, enrollment.enrollmentId as string);
        await ProfileService.createOrUpdateProfileAfterEnrollment(uid, enrollment.enrollmentId as string);

        const profile: any = await ProfileModel.findOne({ user: user._id }).lean();
        expect(profile.enrollments).toHaveLength(1);
    });

    it('createOrUpdateProfileAfterEnrollment throws for unknown enrollmentId', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        await expect(
            ProfileService.createOrUpdateProfileAfterEnrollment(user._id.toString(), 'MA-NONEXISTENT')
        ).rejects.toThrow(/Enrollment not found/i);
    });

    it('updateProfileEnrollmentStatus ensures the reference exists', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await ProfileService.updateProfileEnrollmentStatus(
            enrollment.enrollmentId as string,
            EnrollmentStatus.Completed
        );

        const profile: any = await ProfileModel.findOne({ user: user._id }).lean();
        expect(profile.enrollments.map((e: any) => e.enrollmentId)).toContain(
            enrollment.enrollmentId
        );
    });

    it('getCompleteStudentProfile returns enrollment stats', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await ProfileService.createOrUpdateProfileAfterEnrollment(
            user._id.toString(),
            enrollment.enrollmentId as string
        );

        const full: any = await ProfileService.getCompleteStudentProfile(user._id.toString());
        expect(full.enrollmentStats.totalEnrollments).toBe(1);
        expect(full.enrollmentStats.activeEnrollments).toBe(1);
        expect(full.enrollmentStats.completedEnrollments).toBe(0);
        expect(full.enrollmentStats.certificatesEarned).toBe(0);
    });

    it('getCompleteStudentProfile throws when no profile exists', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        await expect(
            ProfileService.getCompleteStudentProfile(user._id.toString())
        ).rejects.toThrow(/Student profile not found/i);
    });

    it('syncAllUserEnrollmentsToProfile backfills missing refs and drops stale ones', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const e1 = await createEnrollmentWithId(user._id, batch._id);

        // stale ref that no longer exists in Enrollment collection
        await ProfileModel.create({
            user: user._id,
            areasOfInterest: [],
            enrollments: [{ enrollmentId: 'MA-STALE-REF' }],
        });

        await ProfileService.syncAllUserEnrollmentsToProfile(user._id.toString());

        const profile: any = await ProfileModel.findOne({ user: user._id }).lean();
        const ids = profile.enrollments.map((e: any) => e.enrollmentId);
        expect(ids).toContain(e1.enrollmentId);
        expect(ids).not.toContain('MA-STALE-REF');
    });

    it('removeEnrollmentFromProfile pulls the ref', async () => {
        const user = await createUser({ email: `prof-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await ProfileService.createOrUpdateProfileAfterEnrollment(
            user._id.toString(),
            enrollment.enrollmentId as string
        );
        await ProfileService.removeEnrollmentFromProfile(enrollment.enrollmentId as string);

        const profile: any = await ProfileModel.findOne({ user: user._id }).lean();
        expect(profile.enrollments).toHaveLength(0);
    });

    it('removeEnrollmentFromProfile throws for unknown enrollmentId', async () => {
        await expect(ProfileService.removeEnrollmentFromProfile('MA-NONEXISTENT')).rejects.toThrow(
            /Enrollment not found/i
        );
    });
});
