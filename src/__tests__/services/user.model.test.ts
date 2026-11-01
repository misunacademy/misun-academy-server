import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { UserModel } from '../../modules/User/user.model.js';
import { Role } from '../../types/role.js';
import { UserStatus } from '../../types/common.js';

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

describe('UserModel', () => {
    it('creates a user with learner/active defaults', async () => {
        const user = await UserModel.create({
            name: 'Learner One',
            email: `learner-${uniq()}@example.com`,
            password: 'password123',
        });
        expect(user.role).toBe(Role.LEARNER);
        expect(user.status).toBe(UserStatus.Active);
        expect(user.emailVerified).toBe(false);
    });

    it('lowercases email and hashes the password on save', async () => {
        const user = await UserModel.create({
            name: 'Hash Check',
            email: `HASH-${uniq()}@EXAMPLE.com`,
            password: 'password123',
        });
        expect(user.email).toBe(user.email.toLowerCase());
        const raw = await UserModel.findById(user._id).select('+password').lean();
        expect(raw?.password).toBeDefined();
        expect(raw?.password).not.toBe('password123');
    });

    it('comparePassword returns true for the right password and false otherwise', async () => {
        const user = await UserModel.create({
            name: 'Compare Check',
            email: `compare-${uniq()}@example.com`,
            password: 'password123',
        });
        const withPassword: any = await UserModel.findById(user._id).select('+password');
        expect(await withPassword?.comparePassword('password123')).toBe(true);
        expect(await withPassword?.comparePassword('wrong-password')).toBe(false);
    });

    it('comparePassword returns false when no password is set (OAuth user)', async () => {
        const user = await UserModel.create({
            name: 'OAuth User',
            email: `oauth-${uniq()}@example.com`,
        });
        const fetched: any = await UserModel.findById(user._id).select('+password');
        expect(await fetched?.comparePassword('anything')).toBe(false);
    });

    it('exposes profilePicture virtual preferring avatar over image', async () => {
        const user = await UserModel.create({
            name: 'Avatar User',
            email: `avatar-${uniq()}@example.com`,
            avatar: 'https://example.com/avatar.png',
            image: 'https://example.com/image.png',
        });
        expect(user.profilePicture).toBe('https://example.com/avatar.png');

        const imageOnly = await UserModel.create({
            name: 'Image User',
            email: `image-${uniq()}@example.com`,
            image: 'https://example.com/only-image.png',
        });
        expect(imageOnly.profilePicture).toBe('https://example.com/only-image.png');
    });

    it('rejects duplicate emails (unique index)', async () => {
        const email = `dup-${uniq()}@example.com`;
        await UserModel.create({ name: 'First', email, password: 'password123' });
        await expect(
            UserModel.create({ name: 'Second', email, password: 'password123' })
        ).rejects.toThrow();
    });

    it('rejects invalid role values', async () => {
        await expect(
            UserModel.create({
                name: 'Bad Role',
                email: `badrole-${uniq()}@example.com`,
                role: 'superuser',
            })
        ).rejects.toThrow();
    });
});
