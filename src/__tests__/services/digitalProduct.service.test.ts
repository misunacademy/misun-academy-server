import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { DigitalProductService } from '../../modules/DigitalProduct/digitalProduct.service.js';

const baseProduct = () => ({
    title: 'Draft product',
    software: 'photoshop' as const,
    priceBDT: 100,
    priceINR: 100,
    status: 'draft' as const,
});

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('DigitalProductService.createProduct slug generation', () => {
    it('generates a usable slug for Bengali titles that sanitise to a lone dash', async () => {
        const product = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'ফটোশপ স্ক্রিপ্ট - নতুন',
        });

        expect(product.slug).toBeTruthy();
        expect(product.slug.length).toBeGreaterThanOrEqual(2);
        expect(product.slug).not.toBe('-');
    });

    it('treats a blank / single-character slug as absent and falls back to the title', async () => {
        const product = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Valid English Title',
            slug: '-',
        });

        expect(product.slug).toBe('valid-english-title');
    });

    it('keeps an explicit slug and appends a counter on collisions', async () => {
        const first = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'First',
            slug: 'explicit-slug',
        });
        const second = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Second',
            slug: 'explicit-slug',
        });

        expect(first.slug).toBe('explicit-slug');
        expect(second.slug).toBe('explicit-slug-1');
    });
});
