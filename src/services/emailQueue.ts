import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import { createTransporter, sendEmailImmediate } from './emailService.js';

const REDIS_URL = env.REDIS_URL;
let emailQueue: Queue | null = null;
let emailWorker: Worker | null = null;
let isAvailable = false;

const getConnection = (): Redis | null => {
    if (!REDIS_URL) return null;
    try {
        return new Redis(REDIS_URL, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
        });
    } catch {
        return null;
    }
};

export const initializeEmailQueue = async () => {
    if (!REDIS_URL) {
        logger.info('BullMQ: REDIS_URL not set — falling back to MongoDB email queue');
        return;
    }

    try {
        const connection = getConnection();
        if (!connection) throw new Error('Failed to create Redis connection');

        await connection.connect();
        logger.info('BullMQ: Redis connected');

        emailQueue = new Queue('email', { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60000 } } });

        emailWorker = new Worker('email', async (job: Job) => {
            const { to, subject, html, attachments } = job.data;
            try {
                const transporter = createTransporter();
                await transporter.sendMail({
                    from: env.EMAIL_FROM || `"Misun Academy" <${env.EMAIL_USER}>`,
                    to,
                    subject,
                    html,
                    attachments,
                });
                logger.info(`BullMQ email sent: ${to} [${subject}]`);
            } catch (error: any) {
                logger.error(`BullMQ email failed: ${to} - ${error.message}`);
                throw error;
            }
        }, { connection, concurrency: 5 });

        isAvailable = true;
        logger.info('BullMQ email queue initialized');
    } catch (error) {
        logger.warn(`BullMQ initialization failed — falling back to MongoDB queue: ${error}`);
        isAvailable = false;
    }
};

export const queueEmailBullMQ = async (to: string, subject: string, html: string, options?: { attachments?: any[]; eventId?: string }) => {
    if (!isAvailable || !emailQueue) {
        await sendEmailImmediate(to, subject, html);
        return;
    }

    await emailQueue.add('send-email', { to, subject, html, attachments: options?.attachments }, {
        jobId: options?.eventId,
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
    });
};

export const closeEmailQueue = async () => {
    if (emailWorker) await emailWorker.close();
    if (emailQueue) await emailQueue.close();
    isAvailable = false;
};
