import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createEnrollment, createPayment } from '../helpers/factories.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { UserModel } from '../../modules/User/user.model.js';
import { EnrollmentStatus, Status, UserStatus } from '../../types/common.js';
import { PrivacyService } from '../../modules/Privacy/privacy.service.js';
import { ConsentService } from '../../modules/Consent/consent.service.js';

let adminId: mongoose.Types.ObjectId;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
    const admin = await createAdmin();
    adminId = admin._id;
});

describe('Fix 16: Privacy — data export', () => {
    it('exports all user data including enrollments, payments, certificates, progress', async () => {
        const user = await createUser({ email: `export-${Date.now()}@example.com` });
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Active });
        await createPayment(user._id, batch._id, { enrollmentId: enrollment.enrollmentId, status: Status.Success });

        const result = await PrivacyService.exportUserData(user._id.toString());

        expect(result).toBeDefined();
        expect(result.user).toBeDefined();
        expect(result.user.email).toBe(user.email);
        expect(result.enrollments).toBeDefined();
        expect(result.enrollments.length).toBeGreaterThanOrEqual(1);
        expect(result.payments).toBeDefined();
        expect(result.payments.length).toBeGreaterThanOrEqual(1);
    });

    it('export returns empty for user with no data', async () => {
        const user = await createUser({ email: `export-empty-${Date.now()}@example.com` });

        const result = await PrivacyService.exportUserData(user._id.toString());

        expect(result.user).toBeDefined();
        expect(result.enrollments).toEqual([]);
        expect(result.payments).toEqual([]);
        expect(result.certificates).toEqual([]);
    });

    it('redacts sensitive gatewayResponse fields in exported payments', async () => {
        const user = await createUser({ email: `export-redact-${Date.now()}@example.com` });
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Active });
        await createPayment(user._id, batch._id, {
            enrollmentId: enrollment.enrollmentId,
            status: Status.Success,
            gatewayResponse: { cardLast4: '1234', cardNumber: '4111111111111111', cvv: '123', bankName: 'Test Bank' },
        });

        const result = await PrivacyService.exportUserData(user._id.toString());

        const payment = result.payments[0];
        expect(payment.gatewayResponse).toBeDefined();
        expect(payment.gatewayResponse.cardNumber).toBeUndefined();
        expect(payment.gatewayResponse.cvv).toBeUndefined();
    });
});

describe('Fix 16: Privacy — account self-deletion', () => {
    it('soft-deletes user and anonymizes PII', async () => {
        const user = await createUser({ email: `delete-${Date.now()}@example.com`, phone: '01700000000', address: 'Dhaka' });
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Active });

        const result = await PrivacyService.deleteUserAccount(user._id.toString(), user._id.toString(), 'GDPR request');

        expect(result).toBeDefined();

        const persisted = await UserModel.findById(user._id).lean();
        expect(persisted).not.toBeNull();
        expect(persisted!.status).toBe(UserStatus.Deleted);
        expect(persisted!.deletedAt).toBeDefined();
        expect(persisted!.deletedBy).toBe(user._id.toString());
        expect(persisted!.deletionReason).toBe('GDPR request');
        expect(persisted!.email).toBe(`deleted+${user._id}@deleted.invalid`);
        expect(persisted!.name).toBe('Deleted User');
        expect(persisted!.phone).toBeUndefined();
        expect(persisted!.address).toBeUndefined();
        expect(persisted!.anonymizedAt).toBeDefined();
    });

    it('keeps enrollments linked by userId after deletion', async () => {
        const user = await createUser({ email: `delete-keep-${Date.now()}@example.com` });
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Active });

        await PrivacyService.deleteUserAccount(user._id.toString(), user._id.toString(), 'GDPR request');

        const persistedEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
        expect(persistedEnrollment).not.toBeNull();
        expect(persistedEnrollment!.userId.toString()).toBe(user._id.toString());
    });

    it('requires deletionReason', async () => {
        const user = await createUser({ email: `delete-noreason-${Date.now()}@example.com` });

        await expect(
            PrivacyService.deleteUserAccount(user._id.toString(), user._id.toString(), undefined!)
        ).rejects.toThrow(/reason is required/i);
    });
});

describe('Fix 16: Privacy — consent tracking', () => {
    it('records consent for marketing emails', async () => {
        const user = await createUser({ email: `consent-${Date.now()}@example.com` });

        const result = await ConsentService.recordConsent(user._id.toString(), 'marketing_emails', true, 'web');

        expect(result).toBeDefined();
        expect(result.userId.toString()).toBe(user._id.toString());
        expect(result.consentType).toBe('marketing_emails');
        expect(result.granted).toBe(true);
        expect(result.grantedAt).toBeDefined();
    });

    it('revokes consent', async () => {
        const user = await createUser({ email: `consent-revoke-${Date.now()}@example.com` });

        await ConsentService.recordConsent(user._id.toString(), 'marketing_emails', true, 'web');
        const result = await ConsentService.recordConsent(user._id.toString(), 'marketing_emails', false, 'web');

        expect(result.granted).toBe(false);
    });
});
