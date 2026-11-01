/**
 * Chat Conversation Purge Scheduler
 * Purges stored chat conversations older than CHAT_QUOTA.RETENTION_DAYS
 * Runs daily to keep conversation storage bounded.
 */

import { purgeOldConversations } from '../modules/Chat/chat.service.js';
import { logger } from '../config/logger.js';

let purgeRunning = false;

export const purgeOldChatConversations = async (): Promise<{ deleted: number }> => {
    if (purgeRunning) {
        logger.warn('Chat conversation purge skipped: previous run still in progress');
        return { deleted: 0 };
    }
    purgeRunning = true;
    try {
        const deleted = await purgeOldConversations();
        logger.info(`Chat conversation purge completed: ${deleted} records deleted`);
        return { deleted };
    } catch (error: any) {
        logger.error('Chat conversation purge failed: ' + (error?.message || String(error)));
        throw error;
    } finally {
        purgeRunning = false;
    }
};

export const scheduleChatConversationPurge = () => {
    // Run immediately on startup
    purgeOldChatConversations().catch((error: any) => {
        logger.error('Initial chat conversation purge failed:', error);
    });

    // Schedule daily at 3 AM
    const scheduleNextRun = () => {
        const now = new Date();
        const next3AM = new Date();
        next3AM.setHours(3, 0, 0, 0);

        if (now.getHours() >= 3) {
            next3AM.setDate(next3AM.getDate() + 1);
        }

        const msUntil3AM = next3AM.getTime() - now.getTime();

        setTimeout(() => {
            purgeOldChatConversations()
                .catch((error: any) => logger.error('Scheduled chat conversation purge failed:', error));
            scheduleNextRun();
        }, msUntil3AM);

        logger.info(`Next chat conversation purge scheduled for ${next3AM.toLocaleString()}`);
    };

    scheduleNextRun();
};
