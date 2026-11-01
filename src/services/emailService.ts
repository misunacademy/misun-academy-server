import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { EmailLogModel, type IEmailLog, type EmailPriority } from '../models/email.model.js';

// ============================================================================
// 1. CONFIGURATION & TRANSPORTER
// ============================================================================

export const createTransporter = () => {
    // Priority: Explicit Host/Port > Gmail Service
    if (env.EMAIL_HOST) {
        return nodemailer.createTransport({
            host: env.EMAIL_HOST,
            port: Number(env.EMAIL_PORT) || 587,
            secure: env.EMAIL_SECURE === 'true', // true for 465, false for other ports
            auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
        });
    }
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
    });
};

// ============================================================================
// 2. ROBUST QUEUE PROCESSOR (Polling)
// ============================================================================

class EmailWorker {
    private isProcessing = false;
    private BATCH_SIZE = 5;
    private POLL_INTERVAL = 5000; // 5 seconds
    private STALE_PROCESSING_MS = 10 * 60 * 1000; // crash recovery window
    private timer: NodeJS.Timeout | null = null;

    constructor() {
        this.startWorker();
    }

    private startWorker() {
        // Crash recovery: jobs stuck in `processing` (crash after claim, before
        // completion) would never be reaped — requeue them once at startup.
        void this.requeueStaleProcessing().catch((error) => {
            logger.error(`Email Worker requeue failed: ${error}`);
        });
        this.timer = setInterval(() => this.processQueue(), this.POLL_INTERVAL);
        // Never keep the event loop alive for a background poller (lets
        // `node --forceExit`-free shutdowns and tests exit cleanly).
        this.timer.unref?.();
        logger.info('📧 Email Worker Started');
    }

    stopWorker() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async requeueStaleProcessing() {
        if (mongoose.connection.readyState !== 1) return;
        const cutoff = new Date(Date.now() - this.STALE_PROCESSING_MS);
        const result = await EmailLogModel.updateMany(
            { status: 'processing', updatedAt: { $lte: cutoff } },
            { $set: { status: 'pending', nextAttemptAt: new Date() } }
        );
        if (result.modifiedCount > 0) {
            logger.warn(`Email Worker: requeued ${result.modifiedCount} stale processing job(s)`);
        }
    }

    /**
     * Fetch pending emails from DB and send them.
     * This ensures emails aren't lost if server restarts.
     */
    private async processQueue() {
        if (this.isProcessing) return;

        // Check if DB is connected
        if (mongoose.connection.readyState !== 1) {
            logger.warn('Email Worker: Database not connected, skipping queue processing');
            return;
        }

        this.isProcessing = true;

        try {
            // Atomic claim: flip pending -> processing in a single write so two
            // dynos/instances can never double-send the same job.
            const now = new Date();
            const claimedIds: string[] = [];
            for (let i = 0; i < this.BATCH_SIZE; i++) {
                const claimed = await EmailLogModel.findOneAndUpdate(
                    {
                        status: 'pending',
                        nextAttemptAt: { $lte: now },
                    },
                    { $set: { status: 'processing' } },
                    { sort: { priority: -1, createdAt: 1 }, new: true }
                );
                if (!claimed) break;
                claimedIds.push(String(claimed._id));
            }

            if (claimedIds.length > 0) {
                const jobs = await EmailLogModel.find({ _id: { $in: claimedIds } });
                await Promise.all(jobs.map(job => this.sendJob(job)));
            }

        } catch (error) {
            logger.error(`Email Worker Error: ${error}`);
        } finally {
            this.isProcessing = false;
        }
    }

    private async sendJob(job: IEmailLog) {
        const transporter = createTransporter();

        try {
            await transporter.sendMail({
                from: env.EMAIL_FROM || `"Misun Academy" <${env.EMAIL_USER}>`,
                to: job.to,
                subject: job.subject,
                html: job.html,
                attachments: job.attachments,
                // One-click unsubscribe (RFC 8058): required for bulk mail
                // deliverability (Gmail/Yahoo bulk-sender rules).
                headers: {
                    'List-Unsubscribe': `<mailto:${env.EMAIL_USER}?subject=unsubscribe>`,
                    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                },
            });

            // Success
            job.status = 'sent';
            job.attempts += 1;
            await job.save();
            logger.info(`✅ Email sent: ${job.to} [${job.subject}]`);

        } catch (error: any) {
            job.attempts += 1;
            job.lastError = error.message;

            if (job.attempts >= job.maxRetries) {
                job.status = 'failed';
                logger.error(`❌ Email permanently failed: ${job.to} - ${error.message}`);
            } else {
                job.status = 'pending';
                // Exponential backoff: 1min, 4min, 9min...
                const delayMinutes = Math.pow(job.attempts, 2);
                job.nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000);
                logger.warn(`⚠️ Email retry scheduled: ${job.to} in ${delayMinutes}m`);
            }
            await job.save();
        }
    }
}

// Check if running in serverless environment (Vercel)
const isServerless = process.env.VERCEL || process.env.VERCEL_ENV === 'production';

// Initialize Worker only in non-serverless environments
let worker: EmailWorker | null = null;

export const initializeEmailWorker = async () => {
    logger.info(`Email Worker: isServerless=${isServerless}, VERCEL=${process.env.VERCEL}, VERCEL_ENV=${process.env.VERCEL_ENV}`);

    if (!isServerless && !worker) {
        worker = new EmailWorker();
    }
};

export const stopEmailWorker = () => {
    worker?.stopWorker();
    worker = null;
};

// ============================================================================
// 3. PUBLIC API
// ============================================================================

interface EmailOptions {
    priority?: EmailPriority;
    attachments?: any[];
    eventId?: string; // For idempotency
    eventType?: string;
}

/**
 * Main function to queue an email.
 * In serverless environments, sends immediately. Otherwise, queues to DB.
 */
export const queueEmail = async (
    to: string,
    subject: string,
    html: string,
    options: EmailOptions = {}
) => {
    // In serverless environments, send immediately to avoid DB issues
    if (isServerless) {
        try {
            await sendEmailImmediate(to, subject, html);
            logger.info(`✅ Email sent immediately (serverless): ${to} [${subject}]`);
            return;
        } catch (error) {
            logger.error(`Failed to send email immediately: ${error}`);
            // Persist for retry instead of dropping OTPs/receipts: a
            // long-running instance (or the next invocation's worker path)
            // can pick the pending row up.
            try {
                await EmailLogModel.create({
                    to,
                    subject,
                    html,
                    priority: options.priority || 'normal',
                    eventType: options.eventType,
                    eventId: options.eventId,
                    attachments: options.attachments,
                    status: 'pending',
                    maxRetries: Number(env.EMAIL_MAX_RETRIES) || 3,
                    lastError: (error as Error)?.message,
                });
            } catch (dbError) {
                logger.error(`Failed to persist failed serverless email: ${dbError}`);
            }
            throw error;
        }
    }

    // MongoDB-based queue
    try {
        // Idempotency Check
        if (options.eventId && options.eventType) {
            const exists = await EmailLogModel.exists({
                eventType: options.eventType,
                eventId: options.eventId,
                to
            });
            if (exists) {
                logger.info(`ℹ️ Duplicate email skipped: ${options.eventType} ID: ${options.eventId}`);
                return;
            }
        }

        await EmailLogModel.create({
            to,
            subject,
            html,
            priority: options.priority || 'normal',
            eventType: options.eventType,
            eventId: options.eventId,
            attachments: options.attachments,
            status: 'pending',
            maxRetries: Number(env.EMAIL_MAX_RETRIES) || 3,
        });
    } catch (error) {
        logger.error(`Failed to queue email: ${error}`);
        // Fallback: Try to send immediately if DB fails
        try {
            await sendEmailImmediate(to, subject, html);
            logger.warn(`📧 Email sent as fallback (DB failed): ${to} [${subject}]`);
        } catch (fallbackError) {
            logger.error(`Fallback email send also failed: ${fallbackError}`);
            throw fallbackError;
        }
    }
};

/**
 * Send Immediately (Awaitable) - Use sparingly (e.g., OTPs where latency matters)
 */
export const sendEmailImmediate = async (to: string, subject: string, html: string) => {
    const transporter = createTransporter();
    return await transporter.sendMail({
        from: env.EMAIL_FROM || `"Misun Academy" <${env.EMAIL_USER}>`,
        to,
        subject,
        html,
        headers: {
            'List-Unsubscribe': `<mailto:${env.EMAIL_USER}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
    });
};
