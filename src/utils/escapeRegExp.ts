// Escape user input before embedding it in a MongoDB $regex. Prevents
// regex-injection / ReDoS via crafted search strings.
export const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
