import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createCourse, createBatch, createEnrollment } from '../helpers/factories.js';
import { EnrollmentPerkService } from '../../modules/EnrollmentPerk/enrollmentPerk.service.js';
import { EnrollmentPerkRuleModel } from '../../modules/EnrollmentPerk/enrollmentPerkRule.model.js';
import { PerkGrantModel } from '../../modules/EnrollmentPerk/perkGrant.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { PerkBenefitType } from '../../modules/EnrollmentPerk/enrollmentPerk.interface.js';
import { EnrollmentStatus } from '../../types/common.js';
import { BootcampCatalogModel } from '../../modules/Bootcamp/bootcampCatalog.model.js';
import { BootcampPurchaseModel } from '../../modules/Bootcamp/bootcampPurchase.model.js';
import { BootcampPurchaseStatus, BootcampStatus, RecordedStatus } from '../../modules/Bootcamp/bootcampCatalog.interface.js';

describe('EnrollmentPerkService', () => {
    let adminUser: any;
    let learner: any;
    let courseA: any;
    let batchA1: any;
    let courseB: any;
    let batchB1: any;

    beforeAll(async () => {
        await connectTestDB();
    });

    afterAll(async () => {
        await disconnectTestDB();
    });

    beforeEach(async () => {
        await clearTestDB();

        adminUser = await createUser({ role: 'admin', email: 'admin@example.com' });
        learner = await createUser({ role: 'learner', email: 'learner@example.com' });

        courseA = await createCourse(adminUser._id, { title: 'Course A', slug: 'course-a' });
        batchA1 = await createBatch(courseA._id, { title: 'Batch A1', batchNumber: 1 });

        courseB = await createCourse(adminUser._id, { title: 'Bonus Bootcamp B', slug: 'bootcamp-b' });
        batchB1 = await createBatch(courseB._id, { title: 'Batch B1', batchNumber: 1 });
    });

    describe('createRule', () => {
        it('should successfully create an active perk rule', async () => {
            const rule = await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Free Bootcamp for Batch A1',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                            accessDuration: { type: 'lifetime' },
                        },
                    ],
                },
                adminUser._id.toString()
            );

            expect(rule).toBeDefined();
            expect(rule.title).toBe('Free Bootcamp for Batch A1');
            expect(rule.benefits).toHaveLength(1);
            expect(rule.benefits[0].targetCourseId?.toString()).toBe(courseB._id.toString());
        });

        it('should reject benefit if target course is identical to source course', async () => {
            await expect(
                EnrollmentPerkService.createRule(
                    {
                        courseId: courseA._id,
                        batchId: batchA1._id,
                        title: 'Self target rule',
                        benefits: [
                            {
                                type: PerkBenefitType.FreeCourse,
                                targetCourseId: courseA._id,
                            },
                        ],
                    },
                    adminUser._id.toString()
                )
            ).rejects.toThrow('A benefit course cannot be the same as the enrolled course');
        });

        it('should prevent duplicate active rules for the same course and batch', async () => {
            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Rule 1',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            await expect(
                EnrollmentPerkService.createRule(
                    {
                        courseId: courseA._id,
                        batchId: batchA1._id,
                        title: 'Rule 2 duplicate',
                        isActive: true,
                        benefits: [
                            {
                                type: PerkBenefitType.FreeCourse,
                                targetCourseId: courseB._id,
                            },
                        ],
                    },
                    adminUser._id.toString()
                )
            ).rejects.toThrow('An active perk rule already exists for this course and batch');
        });
    });

    describe('grantPerksForEnrollment - matching & granting', () => {
        it('should grant target bonus course when student enrolls in Course A Batch 1', async () => {
            // Create active rule
            const rule = await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Batch A1 Free Bootcamp',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                            targetBatchId: batchB1._id,
                            accessDuration: { type: 'lifetime' },
                        },
                    ],
                },
                adminUser._id.toString()
            );

            // Create active enrollment in course A batch 1
            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            const result = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });

            expect(result.grantedCount).toBe(1);

            // Verify PerkGrant row exists
            const grant = await PerkGrantModel.findOne({
                sourceEnrollmentId: sourceEnrollment._id,
                studentId: learner._id,
            });
            expect(grant).not.toBeNull();
            expect(grant?.status).toBe('granted');
            expect(grant?.targetCourseId?.toString()).toBe(courseB._id.toString());

            // Verify complimentary enrollment in course B
            const bonusEnrollment = await EnrollmentModel.findById(grant?.targetEnrollmentId);
            expect(bonusEnrollment).not.toBeNull();
            expect(bonusEnrollment?.status).toBe(EnrollmentStatus.Active);
            expect(bonusEnrollment?.batchId.toString()).toBe(batchB1._id.toString());
            expect(bonusEnrollment?.grantedViaPerk).toBe(true);
            expect(bonusEnrollment?.perkRuleId?.toString()).toBe(rule._id.toString());
            expect(bonusEnrollment?.perkSourceEnrollmentId?.toString()).toBe(sourceEnrollment._id.toString());
        });

        it('should automatically resolve best batch if targetBatchId was not specified', async () => {
            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Auto Batch Resolution',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            const result = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });

            expect(result.grantedCount).toBe(1);
            const bonusEnrollment = await EnrollmentModel.findOne({
                userId: learner._id,
                batchId: batchB1._id,
            });
            expect(bonusEnrollment).not.toBeNull();
            expect(bonusEnrollment?.grantedViaPerk).toBe(true);
        });
    });

    describe('grantPerksForEnrollment - idempotency & duplicate prevention', () => {
        it('should never double-grant if grantPerksForEnrollment is executed multiple times', async () => {
            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Idempotency Test',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            // 1st run
            const res1 = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });
            expect(res1.grantedCount).toBe(1);

            // 2nd run (idempotency check)
            const res2 = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });
            expect(res2.grantedCount).toBe(0);

            // Count total enrollments in course B for this student: must remain exactly 1
            const count = await EnrollmentModel.countDocuments({
                userId: learner._id,
                batchId: batchB1._id,
            });
            expect(count).toBe(1);
        });

        it('should not create a duplicate enrollment if student is already enrolled in target course', async () => {
            // Pre-enroll student in target Course B
            await createEnrollment(learner._id, batchB1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Pre-enrolled student test',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });

            // Total enrollments in batch B must still be 1 (the original one)
            const enrollments = await EnrollmentModel.find({
                userId: learner._id,
                batchId: batchB1._id,
            });
            expect(enrollments).toHaveLength(1);
            expect(enrollments[0].grantedViaPerk).toBeFalsy();
        });
    });

    describe('grantPerksForEnrollment - inactive rules & date ranges', () => {
        it('should NOT grant perks if rule is inactive', async () => {
            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Inactive Rule',
                    isActive: false,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            const res = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });
            expect(res.grantedCount).toBe(0);

            const bonus = await EnrollmentModel.findOne({
                userId: learner._id,
                batchId: batchB1._id,
            });
            expect(bonus).toBeNull();
        });

        it('should NOT grant perks if offer start date is in the future', async () => {
            const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await EnrollmentPerkRuleModel.create({
                courseId: courseA._id,
                batchId: batchA1._id,
                title: 'Future Offer',
                isActive: true,
                startDate: futureStart,
                benefits: [
                    {
                        type: PerkBenefitType.FreeCourse,
                        targetCourseId: courseB._id,
                    },
                ],
                createdBy: adminUser._id,
            });

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            const res = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });
            expect(res.grantedCount).toBe(0);
        });

        it('should NOT grant perks if offer end date has already passed', async () => {
            const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
            await EnrollmentPerkRuleModel.create({
                courseId: courseA._id,
                batchId: batchA1._id,
                title: 'Expired Offer',
                isActive: true,
                endDate: pastEnd,
                benefits: [
                    {
                        type: PerkBenefitType.FreeCourse,
                        targetCourseId: courseB._id,
                    },
                ],
                createdBy: adminUser._id,
            });

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            const res = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });
            expect(res.grantedCount).toBe(0);
        });
    });

    describe('backfill for existing students', () => {
        it('should correctly preview and execute backfill for existing enrolled students', async () => {
            // Enroll student 1 & student 2 before creating rule
            const learner2 = await createUser({ email: 'learner2@example.com' });

            await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });
            await createEnrollment(learner2._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            // Create perk rule
            const rule = await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Backfill Offer',
                    isActive: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            // Preview backfill
            const preview = await EnrollmentPerkService.previewBackfill(rule._id.toString());
            expect(preview.eligibleCount).toBe(2);

            // Execute backfill
            const execResult = await EnrollmentPerkService.executeBackfill(
                rule._id.toString(),
                { id: adminUser._id.toString(), role: 'admin' }
            );
            expect(execResult.totalGranted).toBe(2);

            // Check that both learners now have bonus enrollment in course B
            const bonus1 = await EnrollmentModel.findOne({ userId: learner._id, batchId: batchB1._id });
            const bonus2 = await EnrollmentModel.findOne({ userId: learner2._id, batchId: batchB1._id });
            expect(bonus1?.grantedViaPerk).toBe(true);
            expect(bonus2?.grantedViaPerk).toBe(true);

            // Re-running preview should now report 0 eligible
            const preview2 = await EnrollmentPerkService.previewBackfill(rule._id.toString());
            expect(preview2.eligibleCount).toBe(0);
        });
    });

    describe('revokePerksForEnrollment', () => {
        it('should revoke granted perk and suspend target enrollment when source enrollment is refunded', async () => {
            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Revoke test rule',
                    isActive: true,
                    revokeOnCancel: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeCourse,
                            targetCourseId: courseB._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            // Grant perk
            await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });

            const bonusEnrollment = await EnrollmentModel.findOne({
                userId: learner._id,
                batchId: batchB1._id,
            });
            expect(bonusEnrollment?.status).toBe(EnrollmentStatus.Active);

            // Revoke perks for source enrollment
            const revokeRes = await EnrollmentPerkService.revokePerksForEnrollment({
                sourceEnrollmentId: sourceEnrollment._id.toString(),
                reason: 'Customer requested refund',
            });
            expect(revokeRes.revokedCount).toBe(1);

            // Verify bonus enrollment is now Suspended
            const afterRevokeEnrollment = await EnrollmentModel.findById(bonusEnrollment?._id);
            expect(afterRevokeEnrollment?.status).toBe(EnrollmentStatus.Suspended);

            // Verify PerkGrant row is marked revoked
            const grant = await PerkGrantModel.findOne({
                sourceEnrollmentId: sourceEnrollment._id,
            });
            expect(grant?.status).toBe('revoked');
            expect(grant?.revokeReason).toBe('Customer requested refund');
        });
    });

    describe('grantPerksForEnrollment - FreeBootcamp benefit', () => {
        it('should grant complimentary bootcamp purchase and revoke on refund', async () => {
            const bootcamp = await BootcampCatalogModel.create({
                title: 'Next.js Fullstack Bootcamp',
                season: 'Season 1',
                slug: `bootcamp-${Date.now()}`,
                status: BootcampStatus.Live,
                recordedStatus: RecordedStatus.Published,
                recordedPrice: 2500,
            });

            await EnrollmentPerkService.createRule(
                {
                    courseId: courseA._id,
                    batchId: batchA1._id,
                    title: 'Free Bootcamp for Batch A1',
                    isActive: true,
                    revokeOnCancel: true,
                    benefits: [
                        {
                            type: PerkBenefitType.FreeBootcamp,
                            targetBootcampId: bootcamp._id,
                        },
                    ],
                },
                adminUser._id.toString()
            );

            const sourceEnrollment = await createEnrollment(learner._id, batchA1._id, {
                status: EnrollmentStatus.Active,
                enrolledAt: new Date(),
            });

            const grantResult = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });

            expect(grantResult.grantedCount).toBe(1);
            expect(grantResult.grants[0].benefitType).toBe(PerkBenefitType.FreeBootcamp);

            // Verify BootcampPurchase record created
            const purchase = await BootcampPurchaseModel.findOne({
                user: learner._id,
                bootcamp: bootcamp._id,
            });
            expect(purchase).toBeDefined();
            expect(purchase?.status).toBe(BootcampPurchaseStatus.Paid);
            expect(purchase?.amount).toBe(0);
            expect(purchase?.method).toBe('manual');

            // Verify idempotency
            const secondGrant = await EnrollmentPerkService.grantPerksForEnrollment({
                enrollmentId: sourceEnrollment._id.toString(),
            });
            expect(secondGrant.grantedCount).toBe(0);
            const totalPurchases = await BootcampPurchaseModel.countDocuments({
                user: learner._id,
                bootcamp: bootcamp._id,
            });
            expect(totalPurchases).toBe(1);

            // Verify revocation
            const revokeRes = await EnrollmentPerkService.revokePerksForEnrollment({
                sourceEnrollmentId: sourceEnrollment._id.toString(),
                reason: 'Enrollment cancelled',
            });
            expect(revokeRes.revokedCount).toBe(1);

            const revokedPurchase = await BootcampPurchaseModel.findById(purchase?._id);
            expect(revokedPurchase?.status).toBe(BootcampPurchaseStatus.Rejected);
        });
    });
});
