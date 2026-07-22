import http, { Server } from 'http';
import app from './app.js';
import env from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB, disconnectDB } from './config/database.js';
import { initializeEmailWorker } from './services/emailService.js';
import { scheduleEmployeeBirthdayReminders } from './utils/employeeBirthdayReminderScheduler.js';
import { initializeSocketIO, closeSocketIO } from './services/socketService.js';

let server: Server | null = null;
let dbConnected = false;

async function initializeDatabase() {
    if (!dbConnected) {
        try {
            await connectDB();
            logger.info('Database connected');
            dbConnected = true;

            initializeEmailWorker();
            scheduleEmployeeBirthdayReminders();
        } catch (error) {
            logger.error(error, 'Error connecting to database');
            throw error;
        }
    }
}

async function startServer() {
    try {
        await initializeDatabase();

        server = http.createServer(app);

        initializeSocketIO(server);

        server.listen(env.PORT, () => {
            logger.info(`Server is running on port ${env.PORT}`);
        });

        handleProcessEvents();
    } catch (error) {
        logger.error(error, 'Error during server startup');
        process.exit(1);
    }
}

async function gracefulShutdown(signal: string) {
    logger.warn(`Received ${signal}, shutting down gracefully...`);

    const shutdownTimeout = setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);

    if (server) {
        server.close(async () => {
            try {
                closeSocketIO();
                await disconnectDB();
                logger.info('Graceful shutdown complete');
            } catch (error) {
                logger.error(error, 'Error during shutdown');
            } finally {
                clearTimeout(shutdownTimeout);
                process.exit(0);
            }
        });

        // Force close connections after 10s
        setTimeout(() => {
            server?.closeAllConnections?.();
        }, 10000);
    } else {
        clearTimeout(shutdownTimeout);
        process.exit(0);
    }
}

function handleProcessEvents() {
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
        logger.error(error, 'Uncaught Exception');
        gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
        logger.error(reason as Error, 'Unhandled Rejection');
        gracefulShutdown('unhandledRejection');
    });
}

if (!process.env.VERCEL) {
    startServer();
}

export default app;
