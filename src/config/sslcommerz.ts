import env from './env.js';

export const sslcommerzConfig = {
    store_id: env.SSL_STORE_ID!,
    store_passwd: env.SSL_STORE_PASSWORD!,
    is_live: env.SSL_IS_LIVE === 'true',
    success_url: `${env.SERVER_URL}/api/v1/payments/status`,
    fail_url: `${env.SERVER_URL}/api/v1/payments/status`,
    cancel_url: `${env.SERVER_URL}/api/v1/payments/status`,
    ipn_url: `${env.SERVER_URL}/api/v1/payments/webhook`,
};
