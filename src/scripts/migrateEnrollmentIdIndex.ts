/**
 * One-off migration script for Payment/Enrollment enrollmentId index fix.
 *
 * REPORT-ONLY mode by default: prints what would change but performs NO writes.
 * Set MIGRATION_EXECUTE=1 to actually drop/sync indexes.
 *
 * Run with: NODE_ENV=test npx tsx src/scripts/migrateEnrollmentIdIndex.ts
 *
 * DANGER: Do NOT run $unset/updateMany on enrollmentId data without explicit
 * confirmation. This script only drops/recreates indexes.
 */

import { connectDB, disconnectDB } from '../config/database.js';
import { PaymentModel } from '../modules/Payment/payment.model.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { logger } from '../config/logger.js';

const EXECUTE = process.env.MIGRATION_EXECUTE === '1';

async function main() {
    await connectDB();

    try {
        // ── (a) Report docs where enrollmentId is null or "" ──
        const nullIdPayments = await PaymentModel.countDocuments({
            $or: [
                { enrollmentId: { $exists: false } },
                { enrollmentId: null },
                { enrollmentId: '' },
            ],
        });

        const nullIdEnrollments = await EnrollmentModel.countDocuments({
            $or: [
                { enrollmentId: { $exists: false } },
                { enrollmentId: null },
                { enrollmentId: '' },
            ],
        });

        logger.info(
            {
                event: 'migration.report',
                nullIdPayments,
                nullIdEnrollments,
                execute: EXECUTE,
            },
            'EnrollmentId index migration report'
        );

        console.log('\n=== EnrollmentId Index Migration Report ===');
        console.log(`Payments with null/missing/empty enrollmentId: ${nullIdPayments}`);
        console.log(`Enrollments with null/missing/empty enrollmentId: ${nullIdEnrollments}`);
        console.log(`Execute mode: ${EXECUTE ? 'YES (will drop/sync indexes)' : 'NO (report only)'}`);

        if (!EXECUTE) {
            console.log(
                '\nTo execute the index changes, run:\n' +
                '  MIGRATION_EXECUTE=1 npx tsx src/scripts/migrateEnrollmentIdIndex.ts\n' +
                '\nWARNING: This drops the existing enrollmentId index and recreates it ' +
                'with partialFilterExpression. Ensure no writes are in flight.\n'
            );
            return;
        }

        // ── (b) Drop the stale enrollmentId index ──
        const paymentIndexes = await PaymentModel.collection.indexes();
        const enrollmentIdIndex = paymentIndexes.find(
            (i: any) => i.key && i.key.enrollmentId === 1
        );

        if (enrollmentIdIndex) {
            logger.info(
                { indexName: enrollmentIdIndex.name },
                'Dropping stale enrollmentId index on payments'
            );
            await PaymentModel.collection.dropIndex(enrollmentIdIndex.name!);
        } else {
            logger.info('No enrollmentId index found on payments — skipping drop');
        }

        const enrollmentIndexes = await EnrollmentModel.collection.indexes();
        const enrollmentIdIndexEnrollment = enrollmentIndexes.find(
            (i: any) => i.key && i.key.enrollmentId === 1
        );

        if (enrollmentIdIndexEnrollment) {
            logger.info(
                { indexName: enrollmentIdIndexEnrollment.name },
                'Dropping stale enrollmentId index on enrollments'
            );
            await EnrollmentModel.collection.dropIndex(enrollmentIdIndexEnrollment.name!);
        } else {
            logger.info('No enrollmentId index found on enrollments — skipping drop');
        }

        // ── (c) Sync the new indexes ──
        await PaymentModel.syncIndexes();
        await EnrollmentModel.syncIndexes();

        logger.info(
            { event: 'migration.complete', execute: true },
            'EnrollmentId index migration completed'
        );
        console.log('\nIndex migration completed successfully.');
    } finally {
        await disconnectDB();
    }
}

main().catch((error) => {
    logger.error(error, 'EnrollmentId index migration failed');
    process.exit(1);
});
