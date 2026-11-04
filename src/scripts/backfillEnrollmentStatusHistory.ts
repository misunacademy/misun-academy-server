/**
 * Backfill EnrollmentStatusHistory baseline rows for existing enrollments.
 *
 * Dry-run by default. Pass --execute to write.
 *
 * For each enrollment that does NOT already have a status-history row, inserts
 * one baseline row:
 *   from = current status, to = current status (no-op transition marker),
 *   actorType = 'system', source = 'backfill', reason = 'Baseline history row'
 *
 * Idempotent: skips enrollments that already have >= 1 history row.
 */
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatusHistoryModel } from '../modules/Enrollment/enrollmentStatusHistory.model.js';
import { logger } from '../config/logger.js';

const DRY_RUN = process.argv.includes('--execute') === false;

async function main() {
    const totalEnrollments = await EnrollmentModel.countDocuments();
    logger.info(`Found ${totalEnrollments} total enrollments`);

    // Find enrollments that already have at least one history row
    const enrolledWithHistory = await EnrollmentStatusHistoryModel.distinct('enrollmentId');
    const alreadyBackfilled = new Set(enrolledWithHistory.map((id) => id.toString()));

    let skipped = 0;
    let wouldWrite = 0;
    let written = 0;
    let errors = 0;

    const cursor = EnrollmentModel.find().lean().cursor({ batchSize: 100 });
    for await (const enrollment of cursor) {
        if (alreadyBackfilled.has(enrollment._id.toString())) {
            skipped += 1;
            continue;
        }

        wouldWrite += 1;

        if (DRY_RUN) {
            logger.info(
                `[DRY-RUN] Would create history for enrollment ${enrollment._id} (${enrollment.enrollmentId}): ${enrollment.status} -> ${enrollment.status}`
            );
            continue;
        }

        try {
            await EnrollmentStatusHistoryModel.create({
                enrollmentId: enrollment._id,
                userId: enrollment.userId,
                batchId: enrollment.batchId,
                from: enrollment.status,
                to: enrollment.status,
                actorType: 'system',
                actorId: undefined,
                reason: 'Baseline history row (backfilled)',
                source: 'backfill',
            });
            written += 1;
        } catch (error) {
            errors += 1;
            logger.error(
                { enrollmentId: enrollment._id, error },
                `Failed to backfill history for enrollment ${enrollment._id}`
            );
        }
    }

    cursor.close();

    logger.info(
        {
            totalEnrollments,
            alreadyBackfilled: skipped,
            wouldWrite,
            written,
            errors,
            dryRun: DRY_RUN,
        },
        'EnrollmentStatusHistory backfill complete'
    );

    if (DRY_RUN) {
        logger.info('DRY-RUN complete — no rows were written. Re-run with --execute to apply.');
        process.exit(0);
    }

    if (errors > 0) {
        process.exit(1);
    }
}

main().catch((error) => {
    logger.error(error, 'Backfill script failed');
    process.exit(1);
});
