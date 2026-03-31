import pino from 'pino';
import env from './env.js';

const isDevelopment = env.NODE_ENV === 'development';

const logger = pino({
    level: env.LOG_LEVEL || 'info',
    base: { pid: process.pid }, // Including process ID
    // If in development, use pino-pretty
    ...(isDevelopment && {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true, // Enable colorization in development
                translateTime: 'SYS:standard', // Human-readable timestamp
                ignore: 'pid,hostname', // Ignore pid and hostname fields in development logs
            },
        },
    }),
});

export { logger };
