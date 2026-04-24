import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { EmailLogModel, IEmailLog, EmailPriority } from '../models/email.model.js';

// ============================================================================
// 1. CONFIGURATION & TRANSPORTER
// ============================================================================

const createTransporter = () => {
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

    constructor() {
        this.startWorker();
    }

    private startWorker() {
        setInterval(() => this.processQueue(), this.POLL_INTERVAL);
        logger.info('📧 Email Worker Started');
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
            // Find jobs: Pending OR (Failed but can retry AND time has passed)
            // Prioritize HIGH priority first
            const jobs = await EmailLogModel.find({
                status: 'pending',
                nextAttemptAt: { $lte: new Date() }
            })
                .sort({ priority: -1, createdAt: 1 }) // High priority first, then oldest
                .limit(this.BATCH_SIZE);

            if (jobs.length > 0) {
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
            // Mark as processing so other workers don't pick it up
            job.status = 'processing';
            await job.save();

            await transporter.sendMail({
                from: env.EMAIL_FROM || `"Misun Academy" <${env.EMAIL_USER}>`,
                to: job.to,
                subject: job.subject,
                html: job.html,
                attachments: job.attachments
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

export const initializeEmailWorker = () => {
    logger.info(`Email Worker: isServerless=${isServerless}, VERCEL=${process.env.VERCEL}, VERCEL_ENV=${process.env.VERCEL_ENV}`);
    if (!isServerless && !worker) {
        worker = new EmailWorker();
    }
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
            throw error;
        }
    }

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
            status: 'pending'
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
        html
    });
};
