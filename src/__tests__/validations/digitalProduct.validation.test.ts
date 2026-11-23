import { describe, it, expect } from '@jest/globals';
import {
    createDigitalProductSchema,
    updateDigitalProductSchema,
} from '../../modules/DigitalProduct/digitalProduct.validation.js';

// Draft bypasses the "files required for published products" refinement so the
// slug rules can be tested in isolation.
const draftBody = { title: 'বাংলা টাইটেল', status: 'draft' as const };

describe('createDigitalProductSchema slug handling', () => {
    it('treats blank and too-short slugs as absent so the service can generate one', () => {
        for (const slug of ['', ' ', '-', '--', 'a']) {
            const parsed = createDigitalProductSchema.parse({ body: { ...draftBody, slug } });
            expect(parsed.body.slug).toBeUndefined();
        }
    });

    it('allows the slug to be omitted entirely', () => {
        const parsed = createDigitalProductSchema.parse({ body: draftBody });
        expect(parsed.body.slug).toBeUndefined();
    });

    it('keeps and trims a valid explicit slug', () => {
        const parsed = createDigitalProductSchema.parse({
            body: { ...draftBody, slug: '  my-slug  ' },
        });
        expect(parsed.body.slug).toBe('my-slug');
    });
});

describe('updateDigitalProductSchema slug handling', () => {
    it('treats an empty slug as "leave unchanged" instead of rejecting it', () => {
        const parsed = updateDigitalProductSchema.parse({ body: { slug: '' } });
        expect(parsed.body.slug).toBeUndefined();
    });

    it('keeps a valid explicit slug', () => {
        const parsed = updateDigitalProductSchema.parse({ body: { slug: 'new-slug' } });
        expect(parsed.body.slug).toBe('new-slug');
    });
});
