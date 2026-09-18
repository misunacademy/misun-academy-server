import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser } from '../helpers/factories.js';
import { AuditLogService } from '../../modules/AuditLog/auditLog.service.js';
import { AuditLogModel } from '../../models/auditLog.model.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('AuditLogService.getAuditLogs', () => {
    it('returns paginated items with meta', async () => {
        const user = await createUser({ email: `audit-${uniq()}@example.com` });
        await AuditLogModel.create([
            { actor: user._id, action: 'user.role_change', targetType: 'User', targetId: '1' },
            { actor: user._id, action: 'user.status_change', targetType: 'User', targetId: '2' },
            { actor: user._id, action: 'bootcamp.create', targetType: 'Bootcamp', targetId: '3' },
        ]);

        const result = await AuditLogService.getAuditLogs({ page: '1', limit: '2' });

        expect(result.items).toHaveLength(2);
        expect(result.meta.total).toBe(3);
        expect(result.meta.page).toBe(1);
        expect(result.meta.limit).toBe(2);
        expect(result.meta.totalPages).toBe(2);
    });

    it('filters by action', async () => {
        const user = await createUser({ email: `audit-${uniq()}@example.com` });
        await AuditLogModel.create([
            { actor: user._id, action: 'user.delete', targetType: 'User' },
            { actor: user._id, action: 'bootcamp.create', targetType: 'Bootcamp' },
        ]);

        const result = await AuditLogService.getAuditLogs({ action: 'user.delete' });

        expect(result.meta.total).toBe(1);
        expect(result.items[0].action).toBe('user.delete');
    });

    it('filters by targetType and actor', async () => {
        const userA = await createUser({ email: `audit-a-${uniq()}@example.com` });
        const userB = await createUser({ email: `audit-b-${uniq()}@example.com` });
        await AuditLogModel.create([
            { actor: userA._id, action: 'user.delete', targetType: 'User' },
            { actor: userB._id, action: 'user.delete', targetType: 'User' },
        ]);

        const byActor = await AuditLogService.getAuditLogs({ actor: (userA._id as unknown as string).toString() });
        expect(byActor.meta.total).toBe(1);

        const byType = await AuditLogService.getAuditLogs({ targetType: 'User' });
        expect(byType.meta.total).toBe(2);
    });

    it('filters by date range (from/to)', async () => {
        const user = await createUser({ email: `audit-${uniq()}@example.com` });
        await AuditLogModel.collection.insertOne({
            actor: user._id,
            action: 'old.action',
            targetType: 'User',
            createdAt: new Date('2020-01-01T00:00:00Z'),
            updatedAt: new Date('2020-01-01T00:00:00Z'),
        });
        await AuditLogModel.create({ actor: user._id, action: 'new.action', targetType: 'User' });

        const result = await AuditLogService.getAuditLogs({ from: '2021-01-01' });

        expect(result.meta.total).toBe(1);
        expect(result.items[0].action).toBe('new.action');
    });

    it('clamps limit to MAX_LIMIT=100 and floors page/limit at 1', async () => {
        const result = await AuditLogService.getAuditLogs({ page: '0', limit: '500' });
        expect(result.meta.page).toBe(1);
        expect(result.meta.limit).toBe(100);
        expect(result.items).toEqual([]);
        expect(result.meta.total).toBe(0);
    });

    it('returns empty result when nothing matches', async () => {
        const result = await AuditLogService.getAuditLogs({ action: 'no.such.action' });
        expect(result.items).toEqual([]);
        expect(result.meta.total).toBe(0);
        expect(result.meta.totalPages).toBe(0);
    });

    it('sorts newest first', async () => {
        const user = await createUser({ email: `audit-${uniq()}@example.com` });
        await AuditLogModel.create({ actor: user._id, action: 'first.action', targetType: 'User' });
        await new Promise((r) => setTimeout(r, 15));
        await AuditLogModel.create({ actor: user._id, action: 'second.action', targetType: 'User' });

        const result = await AuditLogService.getAuditLogs({});
        expect(result.items[0].action).toBe('second.action');
        expect(result.items[1].action).toBe('first.action');
    });
});
