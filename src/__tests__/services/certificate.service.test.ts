import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createActiveEnrollment,
    createEnrollment,
    createModule,
    createModuleProgress,
} from '../helpers/factories.js';
import { CertificateService } from '../../modules/Certificate/certificate.service.js';
import { EnrollmentService } from '../../modules/Enrollment/enrollment.service.js';
import { ProgressService } from '../../modules/Progress/progress.service.js';
import { UserModel } from '../../modules/User/user.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { CertificateModel } from '../../modules/Certificate/certificate.model.js';
import { EnrollmentStatusHistoryModel } from '../../modules/Enrollment/enrollmentStatusHistory.model.js';
import { CertificateStatus, EnrollmentStatus, ProgressStatus } from '../../types/common.js';

import '../../modules/Instructor/instructor.model.js';

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

describe('CertificateService.checkEligibility', () => {
    it('returns true when all modules are 100% complete', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const result = await CertificateService.checkEligibility(enrollment._id.toString());
        expect(result.isEligible).toBe(true);
        expect(result.enrollment).toBeDefined();
    });

    it('returns false when enrollment is not found', async () => {
        const result = await CertificateService.checkEligibility(
            new mongoose.Types.ObjectId().toString()
        );
        expect(result.isEligible).toBe(false);
    });

    it('returns false when enrollment status is not active/completed', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Pending,
        });

        const result = await CertificateService.checkEligibility(enrollment._id.toString());
        expect(result.isEligible).toBe(false);
    });

    it('returns false when course certificate is not available', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: false });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const result = await CertificateService.checkEligibility(enrollment._id.toString());
        expect(result.isEligible).toBe(false);
    });

    it('returns false when modules are incomplete', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.InProgress,
            completionPercentage: 50,
        });

        const result = await CertificateService.checkEligibility(enrollment._id.toString());
        expect(result.isEligible).toBe(false);
    });

    it('treats an empty module as complete so it never blocks eligibility', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        // No lessons, no published quizzes — nothing to complete.
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Locked,
            completionPercentage: 0,
        });

        await ProgressService.recalculateModuleProgress(
            enrollment._id.toString(),
            mod._id.toString()
        );

        const result = await CertificateService.checkEligibility(enrollment._id.toString());
        expect(result.isEligible).toBe(true);
    });

    it('returns false when enrollment belongs to a different user', async () => {        const user1 = await createUser();
        const user2 = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user1._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const result = await CertificateService.checkEligibility(
            enrollment._id.toString(),
            user2._id.toString()
        );
        expect(result.isEligible).toBe(false);
    });
});

describe('CertificateService.requestCertificate', () => {
    it('creates a pending certificate', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const certificate = await CertificateService.requestCertificate(
            enrollment._id.toString(),
            user._id.toString()
        );

        expect(certificate.status).toBe(CertificateStatus.Pending);
        expect(certificate.enrollmentId.toString()).toBe(enrollment._id.toString());
        expect(certificate.certificateId).toMatch(/^CERT-/);
    });

    it('rejects if user does not own the enrollment', async () => {
        const user = await createUser();
        const other = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(other._id, batch._id);

        await expect(
            CertificateService.requestCertificate(
                enrollment._id.toString(),
                user._id.toString()
            )
        ).rejects.toThrow(/Access denied/i);
    });

    it('rejects if certificate already exists', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        await CertificateService.requestCertificate(enrollment._id.toString(), user._id.toString());

        await expect(
            CertificateService.requestCertificate(enrollment._id.toString(), user._id.toString())
        ).rejects.toThrow(/pending admin approval/i);
    });

    it('rejects if not eligible (modules incomplete)', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await expect(
            CertificateService.requestCertificate(enrollment._id.toString(), user._id.toString())
        ).rejects.toThrow(/complete all modules/i);
    });
});

describe('CertificateService.approveCertificate', () => {
    it('approves a pending certificate', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const pending = await CertificateService.requestCertificate(
            enrollment._id.toString(), user._id.toString()
        );

        const approved = await CertificateService.approveCertificate(
            pending.certificateId, admin._id.toString()
        );

        expect(approved.status).toBe(CertificateStatus.Active);

        const updatedEnrollment = await EnrollmentModel.findById(enrollment._id);
        expect(updatedEnrollment?.certificateIssued).toBe(true);
        expect(updatedEnrollment?.status).toBe(EnrollmentStatus.Completed);
    });

    it('rejects non-pending certificate', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const pending = await CertificateService.requestCertificate(
            enrollment._id.toString(), user._id.toString()
        );
        await CertificateService.approveCertificate(pending.certificateId, admin._id.toString());

        await expect(
            CertificateService.approveCertificate(pending.certificateId, admin._id.toString())
        ).rejects.toThrow(/not pending approval/i);
    });
});

describe('CertificateService.issueCertificate', () => {
    it('issues an active certificate directly', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const certificate = await CertificateService.issueCertificate(
            enrollment._id.toString(),
            admin._id.toString()
        );

        expect(certificate.status).toBe(CertificateStatus.Active);

        const updatedEnrollment = await EnrollmentModel.findById(enrollment._id);
        expect(updatedEnrollment?.certificateIssued).toBe(true);
    });

    it('rejects if certificate already exists', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        await CertificateService.issueCertificate(enrollment._id.toString(), admin._id.toString());

        await expect(
            CertificateService.issueCertificate(enrollment._id.toString(), admin._id.toString())
        ).rejects.toThrow(/Certificate already exists/i);
    });
});

describe('CertificateService.verifyCertificate', () => {
    it('returns valid for an active certificate', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const pending = await CertificateService.requestCertificate(
            enrollment._id.toString(), user._id.toString()
        );
        await CertificateService.approveCertificate(pending.certificateId, admin._id.toString());

        const result = await CertificateService.verifyCertificate(pending.certificateId);
        expect(result.isValid).toBe(true);
        expect(result.status).toBe('active');
    });

    it('returns revoked info for a revoked certificate', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const pending = await CertificateService.requestCertificate(
            enrollment._id.toString(), user._id.toString()
        );
        await CertificateService.approveCertificate(pending.certificateId, admin._id.toString());
        await CertificateService.revokeCertificate(
            pending.certificateId, 'Test reason', admin._id.toString()
        );

        const result = await CertificateService.verifyCertificate(pending.certificateId);
        expect(result.isValid).toBe(false);
        expect(result.status).toBe('revoked');
    });
});

describe('CertificateService.revokeCertificate', () => {
    it('revokes with a reason', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const cert = await CertificateService.issueCertificate(
            enrollment._id.toString(), admin._id.toString()
        );

        const revoked = await CertificateService.revokeCertificate(
            cert.certificateId, 'Misconduct', admin._id.toString()
        );

        expect(revoked.status).toBe(CertificateStatus.Revoked);
        expect(revoked.revokedReason).toBe('Misconduct');

        const updatedEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
        expect(updatedEnrollment?.status).toBe(EnrollmentStatus.Completed);
        expect(updatedEnrollment?.certificateIssued).toBe(false);
        expect(updatedEnrollment?.completedAt).toBeDefined();
    });

    it('rejects if already revoked', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const cert = await CertificateService.issueCertificate(
            enrollment._id.toString(), admin._id.toString()
        );
        await CertificateService.revokeCertificate(cert.certificateId, 'First', admin._id.toString());

        await expect(
            CertificateService.revokeCertificate(cert.certificateId, 'Again', admin._id.toString())
        ).rejects.toThrow(/already revoked/i);
    });
});

describe('CertificateService.getUserCertificates', () => {
    it('returns certificates for a user', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        await CertificateService.requestCertificate(enrollment._id.toString(), user._id.toString());

        const certs = await CertificateService.getUserCertificates(user._id.toString());
        expect(certs).toHaveLength(1);
        expect(certs[0].userId.toString()).toBe(user._id.toString());
    });

    it('returns empty array for user with no certificates', async () => {
        const user = await createUser();
        const certs = await CertificateService.getUserCertificates(user._id.toString());
        expect(certs).toEqual([]);
    });
});

describe('CertificateService.getPendingCertificates', () => {
    it('returns only pending certificates', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        await CertificateService.requestCertificate(enrollment._id.toString(), user._id.toString());

        const pending = await CertificateService.getPendingCertificates();
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe(CertificateStatus.Pending);
    });
});

describe('CertificateService.verifyCertificate — orphaned refs', () => {
    it('returns unverifiable instead of crashing when the user was deleted', async () => {
        const user = await createUser();
        const course = await createCourse(admin._id, { isCertificateAvailable: true });
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        const mod = await createModule(course._id, batch._id, 0);
        await createModuleProgress(enrollment._id, mod._id, {
            status: ProgressStatus.Completed,
            completionPercentage: 100,
        });

        const pending = await CertificateService.requestCertificate(
            enrollment._id.toString(), user._id.toString()
        );
        await CertificateService.approveCertificate(pending.certificateId, admin._id.toString());

        await UserModel.deleteOne({ _id: user._id });

        const result = await CertificateService.verifyCertificate(pending.certificateId);
        expect(result.isValid).toBe(false);
        expect(result.status).toBe('unverifiable');
    });

    describe('CertificateService concurrent guard', () => {
        it('approve twice concurrently — exactly one succeeds', async () => {
            const user = await createUser();
            const course = await createCourse(admin._id, { isCertificateAvailable: true });
            const batch = await createBatch(course._id);
            const enrollment = await createActiveEnrollment(user._id, batch._id);
            const mod = await createModule(course._id, batch._id, 0);
            await createModuleProgress(enrollment._id, mod._id, {
                status: ProgressStatus.Completed,
                completionPercentage: 100,
            });

            const cert = await CertificateService.requestCertificate(
                enrollment._id.toString(), user._id.toString()
            );

            const results = await Promise.allSettled([
                CertificateService.approveCertificate(cert.certificateId, admin._id.toString()),
                CertificateService.approveCertificate(cert.certificateId, admin._id.toString()),
            ]);

            const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
            expect(fulfilled).toBe(1);

            const persisted = await CertificateModel.findById(cert._id).lean();
            expect(persisted?.status).toBe(CertificateStatus.Active);
        });

        it('revoke twice concurrently — exactly one succeeds', async () => {
            const user = await createUser();
            const course = await createCourse(admin._id, { isCertificateAvailable: true });
            const batch = await createBatch(course._id);
            const enrollment = await createActiveEnrollment(user._id, batch._id);
            const mod = await createModule(course._id, batch._id, 0);
            await createModuleProgress(enrollment._id, mod._id, {
                status: ProgressStatus.Completed,
                completionPercentage: 100,
            });

            const cert = await CertificateService.issueCertificate(
                enrollment._id.toString(), admin._id.toString()
            );

            const results = await Promise.allSettled([
                CertificateService.revokeCertificate(cert.certificateId, 'Rev1', admin._id.toString()),
                CertificateService.revokeCertificate(cert.certificateId, 'Rev2', admin._id.toString()),
            ]);

            const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
            expect(fulfilled).toBe(1);

            const persisted = await CertificateModel.findById(cert._id).lean();
            expect(persisted?.status).toBe(CertificateStatus.Revoked);
        });

        it('revoke then reissue creates a new certificate', async () => {
            const user = await createUser();
            const course = await createCourse(admin._id, { isCertificateAvailable: true });
            const batch = await createBatch(course._id);
            const enrollment = await createActiveEnrollment(user._id, batch._id);
            const mod = await createModule(course._id, batch._id, 0);
            await createModuleProgress(enrollment._id, mod._id, {
                status: ProgressStatus.Completed,
                completionPercentage: 100,
            });

            const cert = await CertificateService.issueCertificate(
                enrollment._id.toString(), admin._id.toString()
            );
            await CertificateService.revokeCertificate(
                cert.certificateId, 'Revoked', admin._id.toString()
            );

            const reissued = await CertificateService.requestCertificate(
                enrollment._id.toString(), user._id.toString()
            );
            expect(reissued.status).toBe(CertificateStatus.Pending);
            expect(reissued.certificateId).not.toBe(cert.certificateId);
        });

        it('approve on non-completable enrollment is rejected', async () => {
            const user = await createUser();
            const course = await createCourse(admin._id, { isCertificateAvailable: true });
            const batch = await createBatch(course._id);
            const enrollment = await createActiveEnrollment(user._id, batch._id);
            const mod = await createModule(course._id, batch._id, 0);
            await createModuleProgress(enrollment._id, mod._id, {
                status: ProgressStatus.Completed,
                completionPercentage: 100,
            });

            const cert = await CertificateService.requestCertificate(
                enrollment._id.toString(), user._id.toString()
            );

            // Suspend the enrollment so it's no longer Active -> CAS fails
            await EnrollmentService.updateEnrollmentStatus(
                enrollment._id.toString(),
                EnrollmentStatus.Suspended,
                'Disciplinary action',
                { id: admin._id.toString(), role: 'admin' }
            );

            await expect(
                CertificateService.approveCertificate(cert.certificateId, admin._id.toString())
            ).rejects.toMatchObject({ statusCode: 409 });
        });

        it('writes status history on certificate approve', async () => {
            const user = await createUser();
            const course = await createCourse(admin._id, { isCertificateAvailable: true });
            const batch = await createBatch(course._id);
            const enrollment = await createActiveEnrollment(user._id, batch._id);
            const mod = await createModule(course._id, batch._id, 0);
            await createModuleProgress(enrollment._id, mod._id, {
                status: ProgressStatus.Completed,
                completionPercentage: 100,
            });

            const cert = await CertificateService.requestCertificate(
                enrollment._id.toString(), user._id.toString()
            );
            await CertificateService.approveCertificate(cert.certificateId, admin._id.toString());

            const history = await EnrollmentStatusHistoryModel.find({
                enrollmentId: enrollment._id,
                to: EnrollmentStatus.Completed,
            }).lean();

            expect(history.length).toBeGreaterThan(0);
        });
    });
});
