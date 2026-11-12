import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { MigrationTracker } from '../../services/migrationTracker.js';

describe('Fix 17: Migration tracking', () => {
    beforeAll(async () => {
        await connectTestDB();
    });

    afterAll(async () => {
        await disconnectTestDB();
    });

    beforeEach(async () => {
        await clearTestDB();
    });

    it('tracks applied migrations and prevents re-application', async () => {
        const tracker = new MigrationTracker();

        // First application should succeed
        const result1 = await tracker.recordMigration('001_initial_schema');
        expect(result1.applied).toBe(true);

        // Second application should be skipped (already applied)
        const result2 = await tracker.recordMigration('001_initial_schema');
        expect(result2.applied).toBe(false);
        expect(result2.skipped).toBe(true);
    });

    it('lists all applied migrations', async () => {
        const tracker = new MigrationTracker();

        await tracker.recordMigration('001_initial_schema');
        await tracker.recordMigration('002_add_capacity');
        await tracker.recordMigration('003_add_status_history');

        const applied = await tracker.getAppliedMigrations();
        expect(applied).toHaveLength(3);
        expect(applied.map(m => m.migrationId)).toContain('001_initial_schema');
        expect(applied.map(m => m.migrationId)).toContain('002_add_capacity');
        expect(applied.map(m => m.migrationId)).toContain('003_add_status_history');
    });

    it('identifies pending migrations', async () => {
        const tracker = new MigrationTracker();
        const allMigrations = ['001_initial_schema', '002_add_capacity', '003_add_status_history'];

        await tracker.recordMigration('001_initial_schema');

        const pending = await tracker.getPendingMigrations(allMigrations);
        expect(pending).toHaveLength(2);
        expect(pending).toContain('002_add_capacity');
        expect(pending).toContain('003_add_status_history');
    });
});
