/**
 * PaymentGatewayAdapter — the only place that talks to SSLCommerz.
 *
 * Historically this wrapped `sslcommerz-lts`, which is unmaintained and pulls
 * `form-data@2.x` (CRLF injection advisory GHSA-hmw2-7cc7-3qxx) plus
 * `node-fetch@2.x`. The adapter now calls the documented SSLCommerz v4 REST
 * API directly, as described at https://developer.sslcommerz.com/doc/v4/:
 *
 *  - Create session:  POST {base}/gwprocess/v4/api.php  (x-www-form-urlencoded)
 *  - Validate order:  GET  {base}/validator/api/validationserverAPI.php
 *  - Transaction query: GET {base}/validator/api/merchantTransIDvalidationAPI.php
 *                      (?tran_id=…)
 *
 * Docs are explicit that credentials must never reach the browser, so every
 * call originates here on the server.
 *
 * Transport failures resolve to `null` so callers can decide (retry later vs
 * fail hard) without try/catch clutter.
 */
import axios from 'axios';
import { StatusCodes } from 'http-status-codes';
import { logger } from '../config/logger.js';
import { sslcommerzConfig } from '../config/sslcommerz.js';
import ApiError from '../errors/ApiError.js';

interface GatewayInitResponse {
    status?: string;
    failedreason?: string;
    sessionkey?: string;
    GatewayPageURL?: string;
    [key: string]: any;
}

/** Flat, normalized gateway state used by reconciliation callers. */
interface GatewayQueryResponse {
    status?: string;
    tran_id?: string;
    amount?: string;
    currency?: string;
    val_id?: string;
    APIConnect?: string;
    [key: string]: any;
}

interface PaymentGatewayAdapter {
    initiate(paymentData: Record<string, any>): Promise<GatewayInitResponse | null>;
    validate(valId: string): Promise<Record<string, any>>;
    queryTransaction(transactionId: string): Promise<GatewayQueryResponse | null>;
}

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

const isPlainObject = (value: unknown): value is Record<string, any> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

class SslCommerzAdapter implements PaymentGatewayAdapter {
    private storeId: string;
    private storePasswd: string;

    constructor() {
        this.storeId = sslcommerzConfig.storeId;
        this.storePasswd = sslcommerzConfig.storePasswd;

        if (!this.storeId || !this.storePasswd) {
            throw new ApiError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                'Payment gateway not configured'
            );
        }
    }

    async initiate(
        paymentData: Record<string, any>
    ): Promise<GatewayInitResponse | null> {
        // The documented request is a plain form POST. Credentials are appended
        // here (not trusted from the caller) and never logged.
        const form = new URLSearchParams();
        form.set('store_id', this.storeId);
        form.set('store_passwd', this.storePasswd);

        for (const [key, value] of Object.entries(paymentData)) {
            if (key === 'store_id' || key === 'store_passwd') continue;
            if (value === undefined || value === null) continue;
            form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }

        try {
            const { data } = await axios.post(sslcommerzConfig.initUrl, form.toString(), {
                timeout: sslcommerzConfig.timeoutMs,
                headers: {
                    'Content-Type': FORM_CONTENT_TYPE,
                    Accept: 'application/json',
                },
            });

            if (!isPlainObject(data)) {
                logger.error(
                    { responseType: typeof data },
                    'SSLCommerz init returned a non-JSON response'
                );
                return null;
            }

            const response = data as GatewayInitResponse;
            if (response.status && String(response.status).toUpperCase() === 'FAILED') {
                logger.error(
                    { failedreason: response.failedreason, sessionkey: response.sessionkey },
                    'SSLCommerz rejected the payment session request'
                );
            }

            return response;
        } catch (error) {
            logger.error(
                { error, tranId: paymentData?.tran_id },
                'SSLCommerz init failed'
            );
            return null;
        }
    }

    async validate(valId: string): Promise<Record<string, any>> {
        const { data } = await axios.get(sslcommerzConfig.validationUrl, {
            timeout: sslcommerzConfig.timeoutMs,
            params: {
                val_id: valId,
                store_id: this.storeId,
                store_passwd: this.storePasswd,
                format: 'json',
                v: 1,
            },
        });
        return data;
    }

    async queryTransaction(
        transactionId: string
    ): Promise<GatewayQueryResponse | null> {
        try {
            const { data } = await axios.get(sslcommerzConfig.merchantApiUrl, {
                timeout: sslcommerzConfig.timeoutMs,
                params: {
                    tran_id: transactionId,
                    store_id: this.storeId,
                    store_passwd: this.storePasswd,
                    format: 'json',
                    v: 1,
                },
            });

            if (!isPlainObject(data)) return null;

            // Auth/config problems must surface as "unknown", never as
            // "no transaction found", so reconciliation retries later.
            if (data.APIConnect && data.APIConnect !== 'DONE') {
                logger.error(
                    { APIConnect: data.APIConnect, transactionId },
                    'SSLCommerz transaction query was not accepted'
                );
                return null;
            }

            const elements: Record<string, any>[] = Array.isArray(data.element)
                ? data.element.filter(isPlainObject)
                : [];

            if (elements.length === 0) {
                // Some responses inline a single transaction instead of element[].
                return data.status ? (data as GatewayQueryResponse) : null;
            }

            // A single tran_id can accumulate several attempts (retries, failed
            // cards). A captured one wins; otherwise report the latest attempt.
            const paid = elements.find((entry) =>
                ['VALID', 'VALIDATED'].includes(String(entry.status ?? '').toUpperCase())
            );
            const chosen =
                paid ??
                [...elements].sort((a, b) =>
                    String(b.tran_date ?? '').localeCompare(String(a.tran_date ?? ''))
                )[0];

            return {
                ...chosen,
                status: chosen.status,
                tran_id: chosen.tran_id ?? transactionId,
                amount: chosen.amount,
                // `currency` is the settlement currency (what we charged in for
                // BDT); `currency_type` is the requested currency.
                currency: chosen.currency ?? chosen.currency_type,
                val_id: chosen.val_id,
            };
        } catch (error) {
            logger.error({ error, transactionId }, 'SSLCommerz transaction query failed');
            return null;
        }
    }
}

export const paymentGatewayAdapter: PaymentGatewayAdapter = new SslCommerzAdapter();
export type { PaymentGatewayAdapter, GatewayInitResponse, GatewayQueryResponse };
