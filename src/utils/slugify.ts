const slugify = (text: string): string => {
    return text
        .toLowerCase()
        .trim()
        // Keep word chars, whitespace, hyphens, and Bengali (\u0980-\u09FF):
        // stripping Bengali used to yield empty/colliding slugs.
        .replace(/[^\w\s-\u0980-\u09FF]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

export default slugify;
