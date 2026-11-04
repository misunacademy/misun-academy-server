/**
 * PaymentGatewayAdapter — isolates the sslcommerz-lts SDK (which has known
 * unfixed vulnerabilities) behind a stable interface.
 *
 * All gateway I/O goes through this adapter. If/when sslcommerz-lts is
 * replaced, only this file changes — no caller logic is affected.
 *
 * Methods that perform network I/O return null on transport failure so
 * callers can decide (retry later vs fail hard) without try/catch clutter.
 */
import SSLCommerzPayment from 'sslcommerz-lts';
import config from '../config/env.js';
import { logger } from '../config/logger.js';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiError.js';
import axios from 'axios';
import env from '../config/env.js';

const GATEWAY_QUERY_TIMEOUT_MS = 10000;
const GATEWAY_VALIDATION_TIMEOUT_MS = 10000;

interface GatewayInitResponse {
    GatewayPageURL?: string;
    [key: string]: any;
}

interface GatewayQueryResponse {
    [key: string]: any;
}

interface PaymentGatewayAdapter {
    initiate(paymentData: Record<string, any>): Promise<GatewayInitResponse | null>;
    validate(valId: string): Promise<Record<string, any>>;
    queryTransaction(transactionId: string): Promise<GatewayQueryResponse | null>;
}

/**
 * SSLCommerz implementation of the adapter.
 */
class SslCommerzAdapter implements PaymentGatewayAdapter {
    private storeId: string;
    private storePasswd: string;
    private isLive: boolean;

    constructor() {
        this.storeId = config.SSL_STORE_ID;
        this.storePasswd = config.SSL_STORE_PASSWORD;
        this.isLive = config.SSL_IS_LIVE === 'true';

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
        const sslcz = new SSLCommerzPayment(this.storeId, this.storePasswd, this.isLive);
        try {
            const response = await sslcz.init(paymentData);
            return response as GatewayInitResponse;
        } catch (error) {
            logger.error({ error, paymentData: { ...paymentData, store_passwd: '***' } }, 'SSLCommerz init failed');
            return null;
        }
    }

    async validate(valId: string): Promise<Record<string, any>> {
        const { data } = await axios.get(env.SSL_VALIDATION_API, {
            timeout: GATEWAY_VALIDATION_TIMEOUT_MS,
            params: {
                val_id: valId,
                store_id: this.storeId,
                store_passwd: this.storePasswd,
                format: 'json',
            },
        });
        return data;
    }

    async queryTransaction(
        transactionId: string
    ): Promise<GatewayQueryResponse | null> {
        const sslcz = new SSLCommerzPayment(this.storeId, this.storePasswd, this.isLive);
        try {
            const response = await Promise.race([
                sslcz.transactionQueryByTransactionId({ tran_id: transactionId }),
                new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), GATEWAY_QUERY_TIMEOUT_MS)
                ),
            ]);

            if (!response || response instanceof Error || typeof response !== 'object') {
                return null;
            }

            return response as GatewayQueryResponse;
        } catch (error) {
            logger.error({ error, transactionId }, 'SSLCommerz transaction query failed');
            return null;
        }
    }
}

export const paymentGatewayAdapter: PaymentGatewayAdapter = new SslCommerzAdapter();
export type { PaymentGatewayAdapter };
