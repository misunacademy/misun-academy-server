export const firstParam = (value: string | string[]): string =>
    Array.isArray(value) ? value[0] : value;
