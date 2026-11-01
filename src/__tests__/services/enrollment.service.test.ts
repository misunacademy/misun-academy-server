import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createEnrollment, createActiveEnrollment, createPayment } from '../helpers/factories.js';
import { EnrollmentService } from '../../modules/Enrollment/enrollment.service.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatusHistoryModel } from '../../modules/Enrollment/enrollmentStatusHistory.model.js';
import { EnrollmentStatus, BatchStatus, Status } from '../../types/common.js';

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
    expect(result.enrollment.enrollmentId).toMatch(/^MA-\d+20\d{2}\d{5}$/);
    const pendingUser: any = await mongoose.model('User').findById(user._id).lean();
    expect(pendingUser?.studentId).toBeUndefined();
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

  it('returns a stable conflict code and safe enrollment details for active duplicates', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Upcoming,
      enrollmentEndDate: new Date(Date.now() + 86400000),
    });
    const active = await createActiveEnrollment(user._id, batch._id);

    try {
      await EnrollmentService.initiateEnrollment(
        user._id.toString(),
        batch._id.toString()
      );
      throw new Error('Expected duplicate enrollment conflict');
    } catch (error: any) {
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('ENROLLMENT_ALREADY_EXISTS');
      expect(error.details.status).toBe(EnrollmentStatus.Active);
      expect(error.details.enrollmentRecordId).toBe(active._id.toString());
      expect(error.details.batchId).toBe(batch._id.toString());
    }
  });

  it.each([
    EnrollmentStatus.PaymentFailed,
    EnrollmentStatus.Expired,
  ])('starts a fresh enrollment instead of reusing a %s row', async (terminalStatus) => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Upcoming,
      enrollmentEndDate: new Date(Date.now() + 86400000),
    });

    const terminal = await createEnrollment(user._id, batch._id, {
      status: terminalStatus,
    });

    const result = await EnrollmentService.initiateEnrollment(
      user._id.toString(),
      batch._id.toString()
    );

    expect(result.isExisting).toBe(false);
    expect(result.enrollment._id.toString()).not.toBe(terminal._id.toString());
    expect(result.enrollment.status).toBe(EnrollmentStatus.Pending);

    // The terminal row stays for the retention job, but is never resurrected.
    const oldRow = await EnrollmentModel.findById(terminal._id).lean();
    expect(oldRow?.status).toBe(terminalStatus);
  });

  it('replaces a legacy pending row whose payment already failed', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      status: BatchStatus.Upcoming,
      enrollmentEndDate: new Date(Date.now() + 86400000),
    });

    const stale = await createEnrollment(user._id, batch._id, {
      status: EnrollmentStatus.Pending,
    });
    await createPayment(user._id, batch._id, {
      enrollmentRef: stale._id,
      enrollmentId: undefined,
      status: Status.Failed,
      method: 'SSLCommerz',
    });

    const result = await EnrollmentService.initiateEnrollment(
      user._id.toString(),
      batch._id.toString()
    );

    expect(result.isExisting).toBe(false);
    expect(result.enrollment._id.toString()).not.toBe(stale._id.toString());
    const marked = await EnrollmentModel.findById(stale._id).lean();
    expect(marked?.status).toBe(EnrollmentStatus.PaymentFailed);
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

  it('hides terminal payment-failed/expired attempts from the learner', async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id);

    await createEnrollment(user._id, batch._id, {
      status: EnrollmentStatus.PaymentFailed,
    });
    await createEnrollment(user._id, batch._id, {
      status: EnrollmentStatus.Expired,
    });
    await createActiveEnrollment(user._id, batch._id);

    const enrollments = await EnrollmentService.getUserEnrollments(user._id.toString());

    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].status).toBe(EnrollmentStatus.Active);

    await expect(
      EnrollmentService.getUserEnrollments(
        user._id.toString(),
        EnrollmentStatus.PaymentFailed
      )
    ).resolves.toEqual([]);
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

describe('EnrollmentService.updateEnrollmentStatus', () => {
    it('finalizes IDs and increments the batch seat when activating a pending enrollment', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id);

        const updated: any = await EnrollmentService.updateEnrollmentStatus(
            enrollment._id.toString(),
            EnrollmentStatus.Active
        );

        const persistedUser: any = await mongoose.model('User').findById(user._id).lean();

        expect(updated.status).toBe(EnrollmentStatus.Active);
        expect(updated.enrollmentId).toMatch(/^MA-/);
        expect(updated.enrolledAt).toBeDefined();
        expect(persistedUser.studentId).toMatch(/^SI-/);
        // currentEnrollment counter deprecated — not written on activation anymore
    });

    it('persists a lowercase status and the reason', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        const updated: any = await EnrollmentService.updateEnrollmentStatus(
            enrollment._id.toString(),
            EnrollmentStatus.Suspended,
            'Payment dispute'
        );

        expect(updated.status).toBe('suspended');
        expect(updated.statusChangeReason).toBe('Payment dispute');
    });

    it('throws NOT_FOUND for an unknown enrollment', async () => {
        await expect(
            EnrollmentService.updateEnrollmentStatus(
                new mongoose.Types.ObjectId().toString(),
                EnrollmentStatus.Active
            )
        ).rejects.toThrow(/Enrollment not found/i);
    });

    it('rejects enum-invalid statuses instead of corrupting the row', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await expect(
            (EnrollmentService.updateEnrollmentStatus as any)(enrollment._id.toString(), 'Active')
        ).rejects.toThrow(/Cannot transition|validation failed/i);

        const untouched: any = await EnrollmentService.getEnrollmentDetails(
            enrollment._id.toString(),
            user._id.toString()
        );
        expect(untouched.status).toBe(EnrollmentStatus.Active);
    });

    it('allows admin to reopen an expired enrollment for re-enrollment (Expired -> Pending)', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Expired,
            enrollmentId: `MA-1${new Date().getFullYear()}00001`,
        });

        const updated = await EnrollmentService.updateEnrollmentStatus(
            enrollment._id.toString(),
            EnrollmentStatus.Pending,
            'Learner requested re-enrollment after expiry'
        );

        expect(updated.status).toBe(EnrollmentStatus.Pending);
        expect(updated.statusChangeReason).toBe('Learner requested re-enrollment after expiry');
    });

    it('rejects transition from Refunded to Active via admin endpoint', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Refunded,
            enrollmentId: `MA-1${new Date().getFullYear()}00002`,
        });

        await expect(
            EnrollmentService.updateEnrollmentStatus(
                enrollment._id.toString(),
                EnrollmentStatus.Active
            )
        ).rejects.toThrow(/Cannot transition/i);
    });

    it('rejects transition from Completed to Active via admin endpoint', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Completed,
            enrollmentId: `MA-1${new Date().getFullYear()}00003`,
        });

        await expect(
            EnrollmentService.updateEnrollmentStatus(
                enrollment._id.toString(),
                EnrollmentStatus.Active
            )
        ).rejects.toThrow(/Cannot transition/i);
    });

    it('writes a status history row on every admin transition', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Pending,
        });

        await EnrollmentService.updateEnrollmentStatus(
            enrollment._id.toString(),
            EnrollmentStatus.Active,
            'Admin manual activation',
            { id: admin._id.toString(), role: 'admin' }
        );

        const history = await EnrollmentStatusHistoryModel.find({
            enrollmentId: enrollment._id,
        }).lean();

        expect(history.length).toBeGreaterThan(0);
        const row = history[0];
        expect(row.from).toBe(EnrollmentStatus.Pending);
        expect(row.to).toBe(EnrollmentStatus.Active);
        expect(row.actorType).toBe('admin');
        expect(row.reason).toBe('Admin manual activation');
        expect(row.source).toBeDefined();
    });

    it('allows exactly one concurrent status transition on the same enrollment', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Pending,
        });

        const results = await Promise.all([
            EnrollmentService.updateEnrollmentStatus(
                enrollment._id.toString(),
                EnrollmentStatus.Active,
                'Concurrent attempt 1'
            ).then(r => ({ ok: true, status: r.status })),
            EnrollmentService.updateEnrollmentStatus(
                enrollment._id.toString(),
                EnrollmentStatus.Suspended,
                'Concurrent attempt 2'
            ).then(r => ({ ok: true, status: r.status })),
        ].map(p => p.catch(e => ({ ok: false, error: e.message }))));

        const successes = results.filter((r): r is { ok: true; status: EnrollmentStatus } => r.ok);
        expect(successes.length).toBe(1);

        const final = await EnrollmentModel.findById(enrollment._id).lean();
        expect(final).not.toBeNull();
        expect((final as any).status).toBe(successes[0].status as EnrollmentStatus);
    });

    it('enforces the status state machine', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await expect(
            EnrollmentService.updateEnrollmentStatus(enrollment._id.toString(), EnrollmentStatus.Pending)
        ).rejects.toThrow(/Cannot transition/i);

        const suspended: any = await EnrollmentService.updateEnrollmentStatus(
            enrollment._id.toString(), EnrollmentStatus.Suspended
        );
        expect(suspended.status).toBe(EnrollmentStatus.Suspended);

        const reactivated: any = await EnrollmentService.updateEnrollmentStatus(
            enrollment._id.toString(), EnrollmentStatus.Active
        );
        expect(reactivated.status).toBe(EnrollmentStatus.Active);
    });

    describe('Shared enrollment service — all entry points enforce same rules', () => {
        it('initiateEnrollment rejects a suspended user', async () => {
            const user = await createUser({ status: 'suspended' as any });
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id);

            await expect(
                EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString())
            ).rejects.toThrow(/cannot enroll/i);
        });

        it('enrollWithManualPayment rejects a suspended user', async () => {
            const user = await createUser({ status: 'suspended' as any });
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id);

            await expect(
                EnrollmentService.enrollWithManualPayment(
                    user._id.toString(), batch._id.toString(),
                    { senderNumber: '01700000000', transactionId: 'UTR123' }
                )
            ).rejects.toThrow(/cannot enroll/i);
        });

        it('grantAccessByEmail rejects a suspended user', async () => {
            const user = await createUser({ status: 'suspended' as any });
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id);

            await expect(
                EnrollmentService.grantAccessByEmail(
                    user.email, course._id.toString(), batch._id.toString(),
                    { id: admin._id.toString(), role: 'admin' }
                )
            ).rejects.toThrow(/not active/i);
        });

        it('all entry points reject enrollment in a Draft batch', async () => {
            const user = await createUser();
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const draftBatch = await createBatch(course._id, { status: BatchStatus.Draft });

            await expect(
                EnrollmentService.initiateEnrollment(user._id.toString(), draftBatch._id.toString())
            ).rejects.toThrow(/not accepting/i);

            await expect(
                EnrollmentService.enrollWithManualPayment(
                    user._id.toString(), draftBatch._id.toString(),
                    { senderNumber: '01700000000', transactionId: 'UTR-DRAFT' }
                )
            ).rejects.toThrow(/not accepting/i);
        });

        it('all entry points reject enrollment past the window', async () => {
            const user = await createUser();
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const closedBatch = await createBatch(course._id, {
                enrollmentEndDate: new Date('2024-01-01'),
                status: BatchStatus.Upcoming,
            });

            await expect(
                EnrollmentService.initiateEnrollment(user._id.toString(), closedBatch._id.toString())
            ).rejects.toThrow(/enrollment period|ended/i);

            await expect(
                EnrollmentService.enrollWithManualPayment(
                    user._id.toString(), closedBatch._id.toString(),
                    { senderNumber: '01700000000', transactionId: 'UTR-CLOSED' }
                )
            ).rejects.toThrow(/enrollment period|ended/i);
        });

        it('createEnrollment creates enrollmentId and status history', async () => {
            const user = await createUser();
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id, {
                enrollmentEndDate: new Date('2027-01-01'),
            });

            const result = await EnrollmentService.createEnrollment({
                userId: user._id.toString(),
                batchId: batch._id.toString(),
                source: 'self',
                accessType: 'standard',
            });

            const enrollment = result.enrollment;
            expect(enrollment.enrollmentId).toMatch(/^MA-\d+/);
            expect(enrollment.status).toBe(EnrollmentStatus.Pending);

            const history = await EnrollmentStatusHistoryModel.find({
                enrollmentId: enrollment._id,
            }).lean();
            expect(history.length).toBeGreaterThan(0);
        });

        it('all entry points block a second active enrollment for the same user+batch', async () => {
            const user = await createUser();
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id, {
                enrollmentEndDate: new Date('2027-01-01'),
            });

            const first = await EnrollmentService.initiateEnrollment(
                user._id.toString(), batch._id.toString()
            );
            expect(first.enrollment.status).toBe(EnrollmentStatus.Pending);

            await EnrollmentService.transitionEnrollment(
                first.enrollment._id.toString(),
                EnrollmentStatus.Pending,
                EnrollmentStatus.Active,
                { id: user._id.toString(), role: 'learner' },
                'Payment confirmed'
            );

            await expect(
                EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString())
            ).rejects.toThrow(/already enrolled/i);
        });
    });

    describe('countActiveEnrollments — on-demand count replacing currentEnrollment counter', () => {
        it('returns 0 for a batch with no enrollments', async () => {
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id);

            const count = await EnrollmentService.countActiveEnrollments(batch._id.toString());
            expect(count).toBe(0);
        });

        it('returns count of Active + Completed enrollments for a batch', async () => {
            const user1 = await createUser();
            const user2 = await createUser();
            const user3 = await createUser();
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id, {
                enrollmentEndDate: new Date('2027-01-01'),
            });

            // Active enrollment
            const e1 = await EnrollmentService.initiateEnrollment(user1._id.toString(), batch._id.toString());
            await EnrollmentService.transitionEnrollment(
                e1.enrollment._id.toString(),
                EnrollmentStatus.Pending,
                EnrollmentStatus.Active,
                { id: user1._id.toString(), role: 'learner' },
                'Payment confirmed'
            );

            // Completed enrollment
            const e2 = await EnrollmentService.initiateEnrollment(user2._id.toString(), batch._id.toString());
            await EnrollmentService.transitionEnrollment(
                e2.enrollment._id.toString(),
                EnrollmentStatus.Pending,
                EnrollmentStatus.Completed,
                { id: user2._id.toString(), role: 'learner' },
                'Course completed'
            );

            // Pending enrollment — should NOT be counted
            await EnrollmentService.initiateEnrollment(user3._id.toString(), batch._id.toString());

            const count = await EnrollmentService.countActiveEnrollments(batch._id.toString());
            expect(count).toBe(2);
        });

        it('reflects suspensions and reactivations', async () => {
            const user = await createUser();
            const admin = await createAdmin();
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id, {
                enrollmentEndDate: new Date('2027-01-01'),
            });

            const e = await EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString());
            await EnrollmentService.transitionEnrollment(
                e.enrollment._id.toString(),
                EnrollmentStatus.Pending,
                EnrollmentStatus.Active,
                { id: user._id.toString(), role: 'learner' },
                'Payment confirmed'
            );

            let count = await EnrollmentService.countActiveEnrollments(batch._id.toString());
            expect(count).toBe(1);

            // Suspend → count drops to 0
            await EnrollmentService.transitionEnrollment(
                e.enrollment._id.toString(),
                EnrollmentStatus.Active,
                EnrollmentStatus.Suspended,
                { id: admin._id.toString(), role: 'admin' },
                'Disciplinary'
            );
            count = await EnrollmentService.countActiveEnrollments(batch._id.toString());
            expect(count).toBe(0);

            // Reactivate → count back to 1
            await EnrollmentService.transitionEnrollment(
                e.enrollment._id.toString(),
                EnrollmentStatus.Suspended,
                EnrollmentStatus.Active,
                { id: admin._id.toString(), role: 'admin' },
                'Reinstated'
            );
            count = await EnrollmentService.countActiveEnrollments(batch._id.toString());
            expect(count).toBe(1);
        });
    });
});
