import { connectDB, disconnectDB } from '../config/database.js';
import { PaymentModel } from '../modules/Payment/payment.model.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { Status, EnrollmentStatus } from '../types/common.js';
import { logger } from '../config/logger.js';

/**
 * Read-only migration drift report.
 *
 * Reports (a) stuck pending payments, (b) pending enrollments holding an
 * enrollmentId with no successful payment, and (c) paid enrollments with higher
 * IDs than those (gap impact). NO WRITES are performed — review the output and
 * confirm before any cleanup script is run.
 */

async function main() {
    await connectDB();

    try {
        // ── (a) Stuck pending payments ──
        // Payments in Pending state with no enrollmentId (orphaned) or whose
        // enrollment is terminal (PaymentFailed/Expired) — these never burned
        // an enrollmentId but show as Pending in Payment History.
        const stuckPendingPayments = await PaymentModel.find({
            status: Status.Pending,
            method: 'SSLCommerz',
            $or: [
                { enrollmentId: { $exists: false } },
                { enrollmentId: null },
                { enrollmentId: '' },
            ],
        })
            .lean();

        const pendingWithTerminalEnrollment = await PaymentModel.aggregate([
            { $match: { status: Status.Pending, method: 'SSLCommerz', enrollmentId: { $exists: true, $nin: [null, ''] } } },
            {
                $lookup: {
                    from: 'enrollments',
                    localField: 'enrollmentId',
                    foreignField: 'enrollmentId',
                    as: 'enrollment',
                },
            },
            { $unwind: { path: '$enrollment', preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    $or: [
                        { 'enrollment.status': EnrollmentStatus.PaymentFailed },
                        { 'enrollment.status': EnrollmentStatus.Expired },
                        { 'enrollment.status': EnrollmentStatus.Refunded },
                        { enrollment: { $exists: false, $eq: null } },
                    ],
                },
            },
            {
                $project: {
                    transactionId: 1,
                    enrollmentId: 1,
                    amount: 1,
                    createdAt: 1,
                    'enrollment.status': 1,
                    'enrollment._id': 1,
                },
            },
        ]);

        console.log('\n=== (A) Stuck pending payments (no enrollmentId or terminal enrollment) ===');
        console.log(`Count: ${stuckPendingPayments.length + pendingWithTerminalEnrollment.length}`);
        for (const p of stuckPendingPayments) {
            console.log(`  - tran=${p.transactionId} amount=${p.amount} enrollmentId=${p.enrollmentId ?? '<none>'} created=${p.createdAt}`);
        }
        for (const p of pendingWithTerminalEnrollment) {
            console.log(`  - tran=${p.transactionId} amount=${p.amount} enrollmentId=${p.enrollmentId} enrollmentStatus=${p.enrollment?.status ?? '<none>'} created=${p.createdAt}`);
        }

        // ── (b) Pending enrollments holding an enrollmentId with no successful payment ──
        const orphanIdEnrollments = await EnrollmentModel.aggregate([
            {
                $match: {
                    status: { $in: [EnrollmentStatus.Pending, EnrollmentStatus.PaymentPending, EnrollmentStatus.PaymentFailed, EnrollmentStatus.Expired] },
                    enrollmentId: { $exists: true, $nin: [null, ''] },
                },
            },
            {
                $lookup: {
                    from: 'payments',
                    localField: 'enrollmentId',
                    foreignField: 'enrollmentId',
                    as: 'payments',
                },
            },
            {
                $addFields: {
                    hasSuccessPayment: {
                        $anyElementTrue: {
                            $map: {
                                input: '$payments',
                                as: 'p',
                                in: { $eq: ['$$p.status', Status.Success] },
                            },
                        },
                    },
                },
            },
            { $match: { hasSuccessPayment: false } },
            {
                $project: {
                    enrollmentId: 1,
                    status: 1,
                    userId: 1,
                    batchId: 1,
                    createdAt: 1,
                    paymentCount: { $size: '$payments' },
                },
            },
        ]);

        console.log('\n=== (B) Pending/terminal enrollments holding enrollmentId with NO successful payment ===');
        console.log(`Count: ${orphanIdEnrollments.length}`);
        for (const e of orphanIdEnrollments) {
            console.log(`  - enrollmentId=${e.enrollmentId} status=${e.status} created=${e.createdAt} payments=${e.paymentCount}`);
        }

        // ── (c) Paid enrollments with higher IDs than the orphaned ones (gap impact) ──
        const orphanIds = orphanIdEnrollments.map((e) => e.enrollmentId).filter(Boolean);
        if (orphanIds.length > 0) {
            const paidWithHigherIds = await EnrollmentModel.find({
                status: EnrollmentStatus.Active,
                enrollmentId: { $exists: true, $nin: [null, ''] },
            }).lean();

            const higherIdPaid = paidWithHigherIds.filter((e: any) => {
                // Compare the numeric counter part after the year
                // Format: MA-<batch><year><counter>
                const match = e.enrollmentId.match(/MA-\d+(\d{4})(\d{5})$/);
                if (!match) return false;
                const counter = parseInt(match[2], 10);
                return orphanIds.some((oid) => {
                    const omatch = oid.match(/MA-\d+(\d{4})(\d{5})$/);
                    if (!omatch) return false;
                    return counter > parseInt(omatch[2], 10);
                });
            });

            console.log('\n=== (C) Paid (Active) enrollments with higher IDs than orphaned ones (gap impact) ===');
            console.log(`Count: ${higherIdPaid.length}`);
            for (const e of higherIdPaid) {
                console.log(`  - enrollmentId=${e.enrollmentId} status=${e.status} userId=${e.userId} batchId=${e.batchId}`);
            }
        } else {
            console.log('\n=== (C) Gap impact === (no orphaned IDs found, skipping)');
        }

        // ── Show exact write queries (for review only, not executed) ──
        console.log('\n=== EXACT WRITE QUERIES (REVIEW ONLY — NOT EXECUTED) ===');
        console.log(
            `
-- 1. Mark stuck pending payments as Expired (only if no successful payment exists)
--    UPDATE payments SET status='expired', failedAt=NOW(), updatedAt=NOW()
--    WHERE status='pending' AND method='SSLCommerz'
--    AND (enrollmentId IS NULL OR enrollmentId='');

-- 2. Mark pending enrollments with orphaned IDs as Expired (release for reuse)
--    UPDATE enrollments SET status='expired', statusChangeReason='Orphaned enrollmentId, no successful payment'
--    WHERE status IN ('pending','payment-pending','payment-failed','expired')
--    AND enrollmentId IS NOT NULL AND enrollmentId <> ''
--    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.enrollmentId = enrollments.enrollmentId AND p.status='success');

-- 3. Renumbering enrollmentIds is NOT recommended without manual review.
--    The enrollmentId counter (EnrollmentCounterModel) has gaps that cannot be
--    safely collapsed without re-issuing IDs to all affected enrollments and
--    updating all references (emails, posters, certificates, payment rows).
            `.trim()
        );

        logger.info('Migration drift report complete');
    } finally {
        await disconnectDB();
    }
}

main().catch((error) => {
    logger.error(error, 'Migration drift report failed');
    process.exit(1);
});
