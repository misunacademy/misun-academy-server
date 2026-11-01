/**
 * Payment maintenance scheduler (reconciliation + abandoned enrollment expiry).
 *
 * Long-running hosts run it in-process once an hour. On Vercel the same work is
 * exposed at `POST /api/v1/payments/maintenance/run` for Vercel Cron (guarded by
 * CRON_SECRET) — see vercel.json.
 */

import { runPaymentMaintenance } from '../modules/Payment/paymentMaintenance.service.js';
import { logger } from '../config/logger.js';

const HOUR_IN_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

const runOnce = async (): Promise<void> => {
    try {
        await runPaymentMaintenance();
    } catch (error) {
        logger.error(error, 'Payment maintenance run failed');
    }
};

export const schedulePaymentMaintenance = (): void => {
    // Run shortly after startup (give the DB connection a moment) and hourly.
    void runOnce();

    timer = setInterval(() => {
        void runOnce();
    }, HOUR_IN_MS);

    // Never keep the process alive just for this timer.
    timer.unref?.();

    logger.info('Payment maintenance scheduler started (runs every hour)');
};

export const stopPaymentMaintenance = (): void => {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
};
