import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createEnrollment, createActiveEnrollment } from '../helpers/factories.js';
import { EnrollmentService } from '../../modules/Enrollment/enrollment.service.js';
import { EnrollmentStatus, BatchStatus } from '../../types/common.js';

// Register models needed for populate refs
import '../../modules/Instructor/instructor.model.js';
import '../../modules/User/user.model.js';

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

beforeEach(async () => {
  await clearTestDB();
});

describe('EnrollmentService.initiateEnrollment', () => {
  it('creates a pending enrollment for a valid batch', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Upcoming,
      enrollmentEndDate: new Date(Date.now() + 86400000),
    });

    const result = await EnrollmentService.initiateEnrollment(
      user._id.toString(),
      batch._id.toString()
    );

    expect(result.isExisting).toBe(false);
    expect(result.enrollment.status).toBe(EnrollmentStatus.Pending);
    expect(result.enrollment.userId.toString()).toBe(user._id.toString());
  });

  it('rejects enrollment when batch is not accepting', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Completed,
    });

    await expect(
      EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString())
    ).rejects.toThrow(/not accepting/);
  });

  it('rejects enrollment after enrollment end date', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Upcoming,
      enrollmentEndDate: new Date(Date.now() - 86400000),
    });

    await expect(
      EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString())
    ).rejects.toThrow(/enrollment period/i);
  });

  it('is idempotent for pending enrollments', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Upcoming,
      enrollmentEndDate: new Date(Date.now() + 86400000),
    });

    const first = await EnrollmentService.initiateEnrollment(
      user._id.toString(),
      batch._id.toString()
    );
    const second = await EnrollmentService.initiateEnrollment(
      user._id.toString(),
      batch._id.toString()
    );

    expect(second.isExisting).toBe(true);
    expect(second.enrollment._id.toString()).toBe(first.enrollment._id.toString());
  });
});

describe('EnrollmentService.getUserEnrollments', () => {
  it('returns enrollments with progress for a user', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Running,
      enrollmentEndDate: new Date(Date.now() + 86400000),
    });

    await createActiveEnrollment(user._id, batch._id);

    const enrollments = await EnrollmentService.getUserEnrollments(user._id.toString());

    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].status).toBe(EnrollmentStatus.Active);
    expect(enrollments[0].progress).toBeDefined();
    expect(enrollments[0].progress.totalModules).toBe(0);
  });
});

describe('EnrollmentService.getEnrollmentDetails', () => {
  it('returns enrollment details with progress', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Running,
    });

    const enrollment = await createActiveEnrollment(user._id, batch._id);

    const details = await EnrollmentService.getEnrollmentDetails(
      enrollment._id.toString(),
      user._id.toString()
    );

    expect(details._id.toString()).toBe(enrollment._id.toString());
    expect(details.progress).toBeDefined();
    expect(details.progress.totalModules).toBe(0);
    expect(details.progress.completedModules).toBe(0);
  });

  it('throws when enrollment is not found', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();

    await expect(
      EnrollmentService.getEnrollmentDetails(fakeId, new mongoose.Types.ObjectId().toString())
    ).rejects.toThrow('Enrollment not found');
  });
});

describe('EnrollmentService.getSpecialAccessEnrollments', () => {
  it('returns paginated special access enrollments', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id);

    await createEnrollment(user._id, batch._id, {
      accessType: 'special',
      status: EnrollmentStatus.Active,
    });

    const result = await EnrollmentService.getSpecialAccessEnrollments({
      page: 1,
      limit: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.totalPages).toBe(1);
  });
});
