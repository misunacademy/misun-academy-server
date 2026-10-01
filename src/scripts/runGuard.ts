import { pathToFileURL } from 'node:url';

/**
 * ESM-safe "run only when invoked directly" guard. `require.main === module`
 * throws in ESM (no `require`), and bare top-level calls fire on ANY import
 * (tests, tooling) — both patterns have caused accidental prod writes.
 */
export const isDirectRun = (metaUrl: string): boolean => {
    try {
        const invoked = process.argv[1];
        if (!invoked) return false;
        return pathToFileURL(invoked).href === metaUrl;
    } catch {
        return false;
    }
};

/**
 * Destructive scripts must opt in explicitly, and never touch production by
 * accident (a wrong MONGO_URI pointing at prod is one typo away).
 */
export const requireMigrationConfirm = (name: string): void => {
    if (process.env.CONFIRM_MIGRATION !== 'true') {
        throw new Error(`${name} refused: set CONFIRM_MIGRATION=true to run`);
    }
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_MIGRATION !== 'true') {
        throw new Error(`${name} refused in production without ALLOW_PROD_MIGRATION=true`);
    }
};
