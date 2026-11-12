/**
 * Migration: unset deprecated `currentEnrollment` field from all Batch documents.
 *
 * The `currentEnrollment` counter has been replaced by on-demand counting via
 * EnrollmentService.countActiveEnrollments() which uses ACCESS_STATUSES
 * (Active + Completed) as the single definition of "counted as enrolled".
 *
 * This migration is idempotent: running it multiple times is safe because
 * $unset on a missing field is a no-op.
 *
 * Usage:
 *   DRY_RUN=true node dist/scripts/unsetCurrentEnrollment.js   # report only
 *   node dist/scripts/unsetCurrentEnrollment.js                # apply
 *
 * Defaults to dry-run. Set DRY_RUN=false or unset the env var to apply.
 */
import { connectDB } from '../config/database.js';
import { BatchModel } from '../modules/Batch/batch.model.js';
import { logger } from '../config/logger.js';

const DRY_RUN = process.env.DRY_RUN !== 'false';

async function main() {
    await connectDB();

    const totalBatches = await BatchModel.countDocuments();
    const batchesWithCounter = await BatchModel.countDocuments({
        currentEnrollment: { $exists: true, $ne: null },
    });

    logger.info(
        { totalBatches, batchesWithCounter, dryRun: DRY_RUN },
        'currentEnrollment unset migration: starting'
    );

    if (DRY_RUN) {
        logger.info('DRY_RUN — no documents will be modified. Set DRY_RUN=false to apply.');
        process.exit(0);
    }

    const result = await BatchModel.updateMany(
        { currentEnrollment: { $exists: true, $ne: null } },
        { $unset: { currentEnrollment: '' } }
    );

    logger.info(
        { matched: result.matchedCount, modified: result.modifiedCount },
        'currentEnrollment unset migration: complete'
    );

    process.exit(0);
}

main().catch((error) => {
    logger.error(error, 'currentEnrollment unset migration failed');
    process.exit(1);
});
