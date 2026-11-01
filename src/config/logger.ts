import pino from 'pino';
import env from './env.js';

const isDevelopment = env.NODE_ENV === 'development';

// Keys whose values must never reach persistent logs (tokens, secrets, PII).
const REDACT_PATHS = [
    '*.password',
    '*.passwd',
    '*.pass',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
    '*.authorization',
    '*.cookie',
    '*.cookies',
    '*.session',
    '*.secret',
    '*.apiKey',
    '*.email',
    '*.phone',
    '*.phoneNumber',
    '*.senderNumber',
    '*.address',
    '*.nidNumber',
    '*.dateOfBirth',
    '*.verify_sign',
    '*.verify_key',
    '*.store_passwd',
    // Query-string shaped fragments inside logged URLs (?token=, &email= …).
    '*.url',
    'url',
    'originalUrl',
];

const logger = pino({
    level: env.LOG_LEVEL || 'info',
    base: { pid: process.pid }, // Including process ID
    redact: {
        paths: REDACT_PATHS,
        // Censor query-string secrets inside logged URLs instead of dropping
        // the whole field (keeps the path for debugging).
        censor: (value: unknown, path: (string | number)[]) => {
            const last = String(path[path.length - 1] ?? '');
            if ((last === 'url' || last === 'originalUrl') && typeof value === 'string') {
                return value.replace(
                    /([?&])(token|email|phone|code|state|verify_sign|verify_key|val_id|tran_id)=[^&]*/gi,
                    '$1$2=[REDACTED]'
                );
            }
            return '[REDACTED]';
        },
    },
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
