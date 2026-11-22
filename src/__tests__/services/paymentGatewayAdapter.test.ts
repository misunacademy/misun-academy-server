/**
 * SSLCommerz adapter tests — verifies the official v4 REST contract that
 * replaced the `sslcommerz-lts` SDK (see paymentGatewayAdapter.ts).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import axios from 'axios';
import { sslcommerzConfig } from '../../config/sslcommerz.js';
import { paymentGatewayAdapter } from '../../services/paymentGatewayAdapter.js';

const postSpy = jest.spyOn(axios, 'post');
const getSpy = jest.spyOn(axios, 'get');

beforeEach(() => {
    postSpy.mockReset();
    getSpy.mockReset();
});

afterEach(() => {
    postSpy.mockReset();
    getSpy.mockReset();
});

const baseData = {
    store_id: 'attacker-supplied-store',
    store_passwd: 'attacker-supplied-pass',
    total_amount: '5000.00',
    currency: 'BDT',
    tran_id: 'MA-1202600001',
    success_url: 'https://api.example.com/api/v1/payments/status',
    cus_name: 'Test Learner',
    cus_email: 'learner@example.com',
};

describe('sslcommerzConfig endpoints', () => {
    it('uses the documented v4 REST hosts', () => {
        const host = sslcommerzConfig.isLive
            ? 'https://securepay.sslcommerz.com'
            : 'https://sandbox.sslcommerz.com';

        expect(sslcommerzConfig.baseUrl).toBe(host);
        expect(sslcommerzConfig.initUrl).toBe(`${host}/gwprocess/v4/api.php`);
        expect(sslcommerzConfig.merchantApiUrl).toBe(
            `${host}/validator/api/merchantTransIDvalidationAPI.php`
        );
        expect(sslcommerzConfig.validationUrl).toMatch(
            /\/validator\/api\/validationserverAPI\.php$/
        );
    });
});

describe('paymentGatewayAdapter.initiate', () => {
    it('POSTs an urlencoded form with server-side credentials', async () => {
        postSpy.mockResolvedValue({
            data: {
                status: 'SUCCESS',
                sessionkey: 'SESSION123',
                GatewayPageURL: 'https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?Q=PAY',
            },
        });

        const result = await paymentGatewayAdapter.initiate(baseData);

        expect(result?.GatewayPageURL).toContain('gw.php?Q=PAY');
        expect(postSpy).toHaveBeenCalledTimes(1);

        const [url, body, options] = postSpy.mock.calls[0] as any[];
        expect(url).toBe(sslcommerzConfig.initUrl);
        expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

        const form = new URLSearchParams(body);
        // Credentials always come from config, never from the payload.
        expect(form.get('store_id')).toBe(sslcommerzConfig.storeId);
        expect(form.get('store_passwd')).toBe(sslcommerzConfig.storePasswd);
        expect(form.get('tran_id')).toBe(baseData.tran_id);
        expect(form.get('total_amount')).toBe('5000.00');
        expect(form.get('currency')).toBe('BDT');
        expect(form.get('store_id')).not.toBe('attacker-supplied-store');
    });

    it('returns the gateway failure payload so callers can surface failedreason', async () => {
        postSpy.mockResolvedValue({
            data: { status: 'FAILED', failedreason: 'Invalid store credentials' },
        });

        const result = await paymentGatewayAdapter.initiate(baseData);

        expect(result?.status).toBe('FAILED');
        expect(result?.failedreason).toBe('Invalid store credentials');
    });

    it('returns null on transport failure', async () => {
        postSpy.mockRejectedValue(new Error('ECONNRESET'));

        await expect(paymentGatewayAdapter.initiate(baseData)).resolves.toBeNull();
    });

    it('returns null when the gateway answers with HTML instead of JSON', async () => {
        postSpy.mockResolvedValue({ data: '<html>down for maintenance</html>' });

        await expect(paymentGatewayAdapter.initiate(baseData)).resolves.toBeNull();
    });
});

describe('paymentGatewayAdapter.validate', () => {
    it('calls the validation API with server-side credentials', async () => {
        getSpy.mockResolvedValue({ data: { status: 'VALID', tran_id: baseData.tran_id } });

        const result = await paymentGatewayAdapter.validate('VAL_123');

        expect(result.status).toBe('VALID');
        const [url, options] = getSpy.mock.calls[0] as any[];
        expect(url).toBe(sslcommerzConfig.validationUrl);
        expect(options.params).toMatchObject({
            val_id: 'VAL_123',
            store_id: sslcommerzConfig.storeId,
            store_passwd: sslcommerzConfig.storePasswd,
            format: 'json',
        });
    });
});

describe('paymentGatewayAdapter.queryTransaction', () => {
    it('flattens element[] and prefers a captured transaction', async () => {
        getSpy.mockResolvedValue({
            data: {
                APIConnect: 'DONE',
                no_of_trans_found: 2,
                element: [
                    {
                        status: 'FAILED',
                        tran_id: 'MA-1202600001',
                        amount: '5000.00',
                        tran_date: '2026-11-17 10:05:00',
                    },
                    {
                        status: 'VALID',
                        tran_id: 'MA-1202600001',
                        amount: '5000.00',
                        currency: 'BDT',
                        currency_type: 'BDT',
                        val_id: 'VAL_123',
                        tran_date: '2026-11-17 10:00:00',
                    },
                ],
            },
        });

        const snapshot = await paymentGatewayAdapter.queryTransaction('MA-1202600001');

        expect(snapshot).toMatchObject({
            status: 'VALID',
            tran_id: 'MA-1202600001',
            amount: '5000.00',
            currency: 'BDT',
            val_id: 'VAL_123',
        });

        const [url, options] = getSpy.mock.calls[0] as any[];
        expect(url).toBe(sslcommerzConfig.merchantApiUrl);
        expect(options.params).toMatchObject({
            tran_id: 'MA-1202600001',
            store_id: sslcommerzConfig.storeId,
            store_passwd: sslcommerzConfig.storePasswd,
            format: 'json',
        });
    });

    it('falls back to the latest attempt and currency_type when nothing is captured', async () => {
        getSpy.mockResolvedValue({
            data: {
                APIConnect: 'DONE',
                element: [
                    {
                        status: 'PENDING',
                        tran_id: 'MA-1202600001',
                        amount: '5000.00',
                        currency_type: 'BDT',
                        tran_date: '2026-11-17 09:00:00',
                    },
                    {
                        status: 'FAILED',
                        tran_id: 'MA-1202600001',
                        amount: '5000.00',
                        currency_type: 'BDT',
                        tran_date: '2026-11-17 11:00:00',
                    },
                ],
            },
        });

        const snapshot = await paymentGatewayAdapter.queryTransaction('MA-1202600001');

        expect(snapshot?.status).toBe('FAILED');
        expect(snapshot?.currency).toBe('BDT');
    });

    it('returns null when the gateway did not accept the query', async () => {
        getSpy.mockResolvedValue({ data: { APIConnect: 'FAILED', element: [] } });

        await expect(paymentGatewayAdapter.queryTransaction('MA-1')).resolves.toBeNull();
    });

    it('returns null when no transaction matches', async () => {
        getSpy.mockResolvedValue({ data: { APIConnect: 'DONE', no_of_trans_found: 0 } });

        await expect(paymentGatewayAdapter.queryTransaction('MA-1')).resolves.toBeNull();
    });

    it('returns null on transport failure', async () => {
        getSpy.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

        await expect(paymentGatewayAdapter.queryTransaction('MA-1')).resolves.toBeNull();
    });
});
