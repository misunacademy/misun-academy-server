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
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
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

    it('returns false when enrollment belongs to a different user', async () => {
        const user1 = await createUser();
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
