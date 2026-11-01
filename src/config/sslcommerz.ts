import env from './env.js';

const isLive = ['true', '1', 'yes'].includes(String(env.SSL_IS_LIVE).trim().toLowerCase());

export const sslcommerzConfig = {
    store_id: env.SSL_STORE_ID!,
    store_passwd: env.SSL_STORE_PASSWORD!,
    is_live: isLive,
    success_url: `${env.SERVER_URL}/api/v1/payments/status`,
    fail_url: `${env.SERVER_URL}/api/v1/payments/status`,
    cancel_url: `${env.SERVER_URL}/api/v1/payments/status`,
    ipn_url: `${env.SERVER_URL}/api/v1/payments/webhook`,
};
