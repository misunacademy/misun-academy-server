export type CourseBrand = 'MA' | 'EP';

export const CourseBrand = {
    MA: 'MA',
    EP: 'EP',
} as const;

const ENGLISH_BRAND_PATTERN = /\benglish\b/i;

export const isEnglishText = (text?: string | null): boolean =>
    Boolean(text && ENGLISH_BRAND_PATTERN.test(text));

interface BrandSource {
    brand?: string | null;
    title?: string | null;
    slug?: string | null;
}

export const deriveCourseBrand = (course?: BrandSource | null): CourseBrand => {
    if (course?.brand === CourseBrand.MA || course?.brand === CourseBrand.EP) {
        return course.brand;
    }
    return isEnglishText(`${course?.title || ''} ${course?.slug || ''}`)
        ? CourseBrand.EP
        : CourseBrand.MA;
};
