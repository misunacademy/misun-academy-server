/**
 * Batch Lifecycle Auto-Transition Scheduler
 * Automatically transitions batch statuses based on dates
 * Can be run as a cron job or triggered manually by admins
 */

import { BatchModel } from '../modules/Batch/batch.model.js';
import { BatchStatus } from '../types/common.js';
import {logger} from '../config/logger.js';

/**
 * Transition batches based on current date
 * Draft → Upcoming → Running → Completed
 */
export const autoTransitionBatches = async (): Promise<{
  toUpcoming: number;
  toRunning: number;
  toCompleted: number;
}> => {
  const now = new Date();
  let toUpcoming = 0;
  let toRunning = 0;
  let toCompleted = 0;

  try {
    // 1. Draft → Upcoming (when enrollment starts)
    const draftToUpcoming = await BatchModel.updateMany(
      {
        status: BatchStatus.Draft,
        enrollmentStartDate: { $lte: now },
      },
      {
        status: BatchStatus.Upcoming,
      }
    );
    toUpcoming = draftToUpcoming.modifiedCount;

    // 2. Upcoming → Running (when batch starts)
    const upcomingToRunning = await BatchModel.updateMany(
      {
        status: BatchStatus.Upcoming,
        startDate: { $lte: now },
      },
      {
        status: BatchStatus.Running,
      }
    );
    toRunning = upcomingToRunning.modifiedCount;

    // 3. Running → Completed (when batch ends)
    const runningToCompleted = await BatchModel.updateMany(
      {
        status: BatchStatus.Running,
        endDate: { $lte: now },
      },
      {
        status: BatchStatus.Completed,
      }
    );
    toCompleted = runningToCompleted.modifiedCount;

    if (toUpcoming > 0 || toRunning > 0 || toCompleted > 0) {
      logger.info(`Batch auto-transition completed: ${toUpcoming} to Upcoming, ${toRunning} to Running, ${toCompleted} to Completed`);
    }

    return { toUpcoming, toRunning, toCompleted };
  } catch (error: any) {
    logger.error('Batch auto-transition failed: ' + (error?.message || String(error)));
    throw error;
  }
};

/**
 * Schedule auto-transition to run periodically
 * Call this in your server startup
 */
export const scheduleBatchTransitions = () => {
  // Run immediately on startup
  autoTransitionBatches().catch((error: any) => {
    logger.error('Initial batch transition failed: ' + (error?.message || String(error)));
  });

  // Run every hour
  const HOUR_IN_MS = 60 * 60 * 1000;
  setInterval(() => {
    autoTransitionBatches().catch((error: any) => {
      logger.error('Scheduled batch transition failed: ' + (error?.message || String(error)));
    });
  }, HOUR_IN_MS);

  logger.info('Batch auto-transition scheduler started (runs every hour)');
};

/**
 * Get batches that need transition (for admin preview)
 */
export const getBatchesNeedingTransition = async () => {
  const now = new Date();

  const needTransition = await BatchModel.find({
    $or: [
      { status: BatchStatus.Draft, enrollmentStartDate: { $lte: now } },
      { status: BatchStatus.Upcoming, startDate: { $lte: now } },
      { status: BatchStatus.Running, endDate: { $lte: now } },
    ],
  }).select('title status startDate endDate enrollmentStartDate');

  return needTransition;
};
