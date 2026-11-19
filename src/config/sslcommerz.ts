/**
 * SSLCommerz endpoint configuration.
 *
 * Built directly from the documented SSLCommerz v4 REST API
 * (https://developer.sslcommerz.com/doc/v4/) instead of the unmaintained
 * `sslcommerz-lts` SDK, whose transitive `form-data@2.x` dependency carries a
 * CRLF-injection advisory (GHSA-hmw2-7cc7-3qxx).
 *
 * Live hosts:  https://securepay.sslcommerz.com
 * Sandbox:     https://sandbox.sslcommerz.com
 */
import env from './env.js';

const TRUTHY = new Set(['true', '1', 'yes']);

export const isSslCommerzLive = (): boolean =>
    TRUTHY.has(String(env.SSL_IS_LIVE ?? '').trim().toLowerCase());

const baseUrl = isSslCommerzLive()
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';

export const sslcommerzConfig = {
    storeId: env.SSL_STORE_ID!,
    storePasswd: env.SSL_STORE_PASSWORD!,
    isLive: isSslCommerzLive(),
    baseUrl,
    /** Create / get payment session — POST application/x-www-form-urlencoded. */
    initUrl: `${baseUrl}/gwprocess/v4/api.php`,
    /**
     * Order validation API (GET). Derived from SSL_IS_LIVE by default so the
     * sandbox/live switch can never drift between credentials and endpoints;
     * SSL_VALIDATION_API stays as an explicit override for unusual setups.
     */
    validationUrl:
        env.SSL_VALIDATION_API?.trim() ||
        `${baseUrl}/validator/api/validationserverAPI.php`,
    /** Refund, refund query and transaction query API (GET). */
    merchantApiUrl: `${baseUrl}/validator/api/merchantTransIDvalidationAPI.php`,
    success_url: `${env.SERVER_URL}/api/v1/payments/status`,
    fail_url: `${env.SERVER_URL}/api/v1/payments/status`,
    cancel_url: `${env.SERVER_URL}/api/v1/payments/status`,
    ipn_url: `${env.SERVER_URL}/api/v1/payments/webhook`,
    timeoutMs: 10000,
};

export type SslCommerzConfig = typeof sslcommerzConfig;
