import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { DigitalProductService } from '../../modules/DigitalProduct/digitalProduct.service.js';
import { DigitalProductOrderModel } from '../../modules/DigitalProduct/digitalProductOrder.model.js';

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

describe('DigitalProductService.claimFreeProduct', () => {
    const customer = {
        name: 'Free Learner',
        email: 'free@example.com',
        phone: '01700000000',
    };

    const createFreeProduct = () =>
        DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Free script pack',
            status: 'published',
            priceBDT: 0,
            priceINR: 0,
            scriptFile: { fileName: 'free.jsx', url: 'https://example.com/free.jsx' },
            guidePdf: { fileName: 'free.pdf', url: 'https://example.com/free.pdf' },
        });

    it('creates an already-paid zero-amount order for a free product', async () => {
        const product = await createFreeProduct();

        const result = await DigitalProductService.claimFreeProduct(product._id.toString(), customer);

        expect(result.alreadyClaimed).toBe(false);
        expect(result.downloadToken).toHaveLength(48);

        const order = await DigitalProductOrderModel.findOne({
            orderNumber: result.orderNumber,
        }).lean();

        expect(order).not.toBeNull();
        expect(order?.status).toBe('paid');
        expect(order?.paymentMethod).toBe('Free');
        expect(order?.amount).toBe(0);
        expect(order?.currency).toBe('BDT');
    });

    it('returns the existing order instead of creating a duplicate claim', async () => {
        const product = await createFreeProduct();

        const first = await DigitalProductService.claimFreeProduct(product._id.toString(), customer);
        const second = await DigitalProductService.claimFreeProduct(product._id.toString(), customer);

        expect(second.alreadyClaimed).toBe(true);
        expect(second.orderNumber).toBe(first.orderNumber);
        expect(second.downloadToken).toBe(first.downloadToken);
        expect(await DigitalProductOrderModel.countDocuments()).toBe(1);
    });

    it('allows claiming the free region when the other region is paid', async () => {
        const product = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Free in BD only',
            status: 'published',
            priceBDT: 0,
            priceINR: 499,
        });

        const result = await DigitalProductService.claimFreeProduct(product._id.toString(), customer, undefined, 'INR');

        const order = await DigitalProductOrderModel.findOne({
            orderNumber: result.orderNumber,
        }).lean();

        // INR is paid, so the service falls back to the free BDT side.
        expect(order?.currency).toBe('BDT');
        expect(order?.amount).toBe(0);
    });

    it('rejects claiming a product that requires payment', async () => {
        const product = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Paid product',
            status: 'published',
            priceBDT: 500,
            priceINR: 399,
        });

        await expect(
            DigitalProductService.claimFreeProduct(product._id.toString(), customer)
        ).rejects.toThrow('not free');
    });
});

describe('DigitalProductService.updateProduct — switching to free', () => {
    it('clears existing discounts when the product becomes free', async () => {
        const product = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Becoming free',
            status: 'published',
            priceBDT: 500,
            discountPriceBDT: 250,
            priceINR: 399,
            discountPriceINR: 199,
        });

        expect(product.discountPriceBDT).toBe(250);

        await DigitalProductService.updateProduct(product._id.toString(), {
            priceBDT: 0,
            discountPriceBDT: null,
            priceINR: 0,
            discountPriceINR: null,
        });

        const updated = await DigitalProductService.getProductBySlug(product.slug);
        expect(updated.priceBDT).toBe(0);
        expect(updated.discountPriceBDT ?? null).toBeNull();
        expect(updated.priceINR).toBe(0);
        expect(updated.discountPriceINR ?? null).toBeNull();
    });
});

describe('DigitalProductService product ordering', () => {
    it('appends newly created products to the end of the manual order', async () => {
        const first = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'First ordered product',
        });
        const second = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Second ordered product',
        });

        expect(first.sortOrder).toBe(0);
        expect(second.sortOrder).toBe(1);
    });

    it('persists a drag & drop reorder and reflects it in the storefront listing', async () => {
        const first = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Order A',
            status: 'published',
        });
        const second = await DigitalProductService.createProduct({
            ...baseProduct(),
            title: 'Order B',
            status: 'published',
        });

        await DigitalProductService.reorderProducts([
            { id: second._id.toString(), sortOrder: 0 },
            { id: first._id.toString(), sortOrder: 1 },
        ]);

        const products = await DigitalProductService.getBootcampProducts();
        expect(products.map((p) => p.title)).toEqual(['Order B', 'Order A']);
    });
});

describe('DigitalProductService paginated reorder', () => {
    it('reorders one page without disturbing products on other pages', async () => {
        const created = [];
        for (const title of ['Page A1', 'Page A2', 'Page B1', 'Page B2']) {
            created.push(
                await DigitalProductService.createProduct({
                    ...baseProduct(),
                    title,
                    status: 'published',
                })
            );
        }

        // Page 2 (limit 2) contains [Page B1, Page B2]; swap them.
        await DigitalProductService.reorderProducts(
            [
                { id: created[3]._id.toString(), sortOrder: 0 },
                { id: created[2]._id.toString(), sortOrder: 1 },
            ],
            { page: 2, limit: 2 }
        );

        const products = await DigitalProductService.getBootcampProducts();
        expect(products.map((p) => p.title)).toEqual([
            'Page A1',
            'Page A2',
            'Page B2',
            'Page B1',
        ]);
        expect(products.map((p) => p.sortOrder)).toEqual([0, 1, 2, 3]);
    });

    it('supports the admin paginated listing', async () => {
        for (const title of ['List 1', 'List 2', 'List 3']) {
            await DigitalProductService.createProduct({
                ...baseProduct(),
                title,
                status: 'published',
            });
        }

        const firstPage = await DigitalProductService.getAllProductsAdmin({ page: 1, limit: 2 });
        const secondPage = await DigitalProductService.getAllProductsAdmin({ page: 2, limit: 2 });

        expect(firstPage.data.map((p) => p.title)).toEqual(['List 1', 'List 2']);
        expect(secondPage.data.map((p) => p.title)).toEqual(['List 3']);
        expect(firstPage.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPage: 2 });
    });
});
