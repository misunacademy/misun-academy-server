/**
 * Batch Start Reminder Scheduler
 * Sends email reminders 1 day before batch starts
 */

import { BatchModel } from '../modules/Batch/batch.model.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { BatchStatus, EnrollmentStatus } from '../types/common.js';
import { sendCourseBatchStartReminderEmail } from '../services/courseEmailRouter.js';
import { logger } from '../config/logger.js';

/**
 * Send batch start reminders to enrolled students
 * Runs daily to check for batches starting tomorrow
 */

// Overlap guard: the startup run and the scheduled run must never send the
// same batch twice if a previous run is still in flight.
let remindersRunning = false;

export const sendBatchStartReminders = async () => {
    if (remindersRunning) {
        logger.warn('Batch start reminder run skipped: previous run still in progress');
        return;
    }
    remindersRunning = true;
    try {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Set time to start and end of tomorrow
        const tomorrowStart = new Date(tomorrow);
        tomorrowStart.setHours(0, 0, 0, 0);
        
        const tomorrowEnd = new Date(tomorrow);
        tomorrowEnd.setHours(23, 59, 59, 999);

        // Find batches starting tomorrow
        const upcomingBatches = await BatchModel.find({
            status: BatchStatus.Upcoming,
            startDate: {
                $gte: tomorrowStart,
                $lte: tomorrowEnd
            }
        }).populate('courseId', 'title slug');

        logger.info(`Found ${upcomingBatches.length} batches starting tomorrow`);

        // Send reminders for each batch
        for (const batch of upcomingBatches) {
            // Get all active enrollments for this batch
            const enrollments = await EnrollmentModel.find({
                batchId: batch._id,
                status: EnrollmentStatus.Active
            }).populate('userId', 'name email');

            logger.info(`Sending reminders to ${enrollments.length} students for batch ${batch.title}`);

            // Await every send via allSettled: the send helper is async, so a
            // bare call would leave rejections unhandled and log "sent"
            // before the mail is even queued. Failures are collected and
            // summarized instead of vanishing.
            const outcomes = await Promise.allSettled(
                enrollments.map(async (enrollment) => {
                    const user = enrollment.userId as any;
                    if (!user || !user.email) return null;

                    const courseData = (batch as any).courseId;
                    const courseName = typeof courseData === 'object'
                        ? courseData?.title || batch.title
                        : batch.title;
                    const courseSlug = typeof courseData === 'object'
                        ? courseData?.slug || ''
                        : '';

                    await sendCourseBatchStartReminderEmail(
                        { courseName, courseSlug },
                        user.email,
                        user.name,
                        batch.title,
                        batch.startDate.toLocaleDateString()
                    );
                    return user.email as string;
                })
            );

            let sent = 0;
            const failed: string[] = [];
            for (const outcome of outcomes) {
                if (outcome.status === 'fulfilled') {
                    if (outcome.value) sent += 1;
                } else {
                    failed.push(outcome.reason?.message || String(outcome.reason));
                }
            }
            logger.info(
                `Batch reminders for "${batch.title}": ${sent} queued, ${failed.length} failed` +
                (failed.length > 0 ? ` (${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '; …' : ''})` : '')
            );
        }

        logger.info('Batch start reminder check completed');
    } catch (error: any) {
        logger.error('Error sending batch start reminders: ' + (error?.message || error));
    } finally {
        remindersRunning = false;
    }
};

/**
 * Schedule batch start reminders (runs daily at 9 AM)
 */
export const scheduleBatchReminders = () => {
    // Run immediately on startup
    sendBatchStartReminders().catch(error => 
        logger.error('Initial batch reminder check failed:', error)
    );

    // Calculate time until next 9 AM
    const scheduleNextRun = () => {
        const now = new Date();
        const next9AM = new Date();
        next9AM.setHours(9, 0, 0, 0);

        // If it's past 9 AM today, schedule for 9 AM tomorrow
        if (now.getHours() >= 9) {
            next9AM.setDate(next9AM.getDate() + 1);
        }

        const msUntil9AM = next9AM.getTime() - now.getTime();

        setTimeout(() => {
            sendBatchStartReminders().catch(error => 
                logger.error('Scheduled batch reminder check failed:', error)
            );
            // Schedule next run (24 hours later)
            scheduleNextRun();
        }, msUntil9AM);

        logger.info(`Next batch reminder check scheduled for ${next9AM.toLocaleString()}`);
    };

    scheduleNextRun();
};
