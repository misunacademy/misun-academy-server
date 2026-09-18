import { describe, it, expect } from '@jest/globals';
import slugify from '../../utils/slugify.js';
import { deriveCourseBrand, isEnglishText, CourseBrand } from '../../utils/courseBrand.js';
import { firstParam } from '../../utils/firstParam.js';

describe('slugify', () => {
    it('lowercases and replaces spaces with dashes', () => {
        expect(slugify('Hello World')).toBe('hello-world');
    });

    it('strips special characters', () => {
        expect(slugify('AI-Powered Design! @2024')).toBe('ai-powered-design-2024');
    });

    it('collapses underscores and multiple spaces', () => {
        expect(slugify('hello__world   test')).toBe('hello-world-test');
    });

    it('trims leading/trailing whitespace and dashes', () => {
        expect(slugify('  padded title  ')).toBe('padded-title');
    });

    it('handles empty string', () => {
        expect(slugify('')).toBe('');
    });
});

describe('courseBrand', () => {
    it('isEnglishText detects the word "english" case-insensitively as a whole word', () => {
        expect(isEnglishText('English for Professionals')).toBe(true);
        expect(isEnglishText('ENGLISH course')).toBe(true);
        expect(isEnglishText('Graphic Design')).toBe(false);
        expect(isEnglishText(undefined)).toBe(false);
        expect(isEnglishText(null)).toBe(false);
        expect(isEnglishText('')).toBe(false);
    });

    it('deriveCourseBrand respects an explicit brand', () => {
        expect(deriveCourseBrand({ brand: 'EP' })).toBe(CourseBrand.EP);
        expect(deriveCourseBrand({ brand: 'MA' })).toBe(CourseBrand.MA);
    });

    it('deriveCourseBrand infers EP from english title/slug', () => {
        expect(deriveCourseBrand({ title: 'English for Professional Communication' })).toBe('EP');
        expect(deriveCourseBrand({ slug: 'english-course-batch-1' })).toBe('EP');
    });

    it('deriveCourseBrand defaults to MA for non-english courses', () => {
        expect(deriveCourseBrand({ title: 'Graphic Design with Freelancing' })).toBe('MA');
        expect(deriveCourseBrand(null)).toBe('MA');
        expect(deriveCourseBrand(undefined)).toBe('MA');
        expect(deriveCourseBrand({})).toBe('MA');
    });

    it('deriveCourseBrand ignores unknown brand strings and falls back to inference', () => {
        expect(deriveCourseBrand({ brand: 'XX', title: 'English Basics' })).toBe('EP');
        expect(deriveCourseBrand({ brand: 'XX', title: 'Design Basics' })).toBe('MA');
    });
});

describe('firstParam', () => {
    it('returns the string unchanged', () => {
        expect(firstParam('abc')).toBe('abc');
    });

    it('returns the first element of an array', () => {
        expect(firstParam(['a', 'b'])).toBe('a');
    });
});
