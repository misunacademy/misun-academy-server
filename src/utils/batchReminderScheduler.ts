/**
 * Batch Start Reminder Scheduler
 * Sends email reminders 1 day before batch starts
 */

import { BatchModel } from '../modules/Batch/batch.model.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { UserModel } from '../modules/User/user.model.js';
import { BatchStatus, EnrollmentStatus } from '../types/common.js';
import { sendBatchStartReminderEmail } from '../services/emailService.js';
import { logger } from '../config/logger.js';

/**
 * Send batch start reminders to enrolled students
 * Runs daily to check for batches starting tomorrow
 */
export const sendBatchStartReminders = async () => {
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
        }).populate('courseId', 'title');

        logger.info(`Found ${upcomingBatches.length} batches starting tomorrow`);

        // Send reminders for each batch
        for (const batch of upcomingBatches) {
            // Get all active enrollments for this batch
            const enrollments = await EnrollmentModel.find({
                batchId: batch._id,
                status: EnrollmentStatus.Active
            }).populate('userId', 'name email');

            logger.info(`Sending reminders to ${enrollments.length} students for batch ${batch.title}`);

            // Send email to each enrolled student
            for (const enrollment of enrollments) {
                const user = enrollment.userId as any;
                if (user && user.email) {
                    try {
                        sendBatchStartReminderEmail(
                            user.email,
                            user.name,
                            batch.title,
                            batch.startDate.toLocaleDateString()
                        );
                        logger.info(`Reminder sent to ${user.email} for batch ${batch.title}`);
                    } catch (emailError: any) {
                        logger.error(`Failed to send reminder to ${user.email}: ${emailError?.message || emailError}`);
                    }
                }
            }
        }

        logger.info('Batch start reminder check completed');
    } catch (error: any) {
        logger.error('Error sending batch start reminders: ' + (error?.message || error));
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
