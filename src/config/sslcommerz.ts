import env from './env.js';

export const sslcommerzConfig = {
    store_id: env.SSL_STORE_ID!,
    store_passwd: env.SSL_STORE_PASSWORD!,
    is_live: env.SSL_IS_LIVE === 'true', // convert to boolean
    success_url: `${env.SERVER_URL}/success`,
    fail_url: `${env.SERVER_URL}/fail`,
    cancel_url: `${env.SERVER_URL}/cancel`,
    ipn_url: `${env.SERVER_URL}/ipn`,
};
