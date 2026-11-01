import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { SettingsService } from '../../modules/Settings/settings.service.js';
import { Settings } from '../../modules/Settings/settings.model.js';

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('SettingsService.getSettings', () => {
    it('returns null when no settings row exists', async () => {
        const result = await SettingsService.getSettings();
        expect(result).toBeNull();
    });

    it('returns the settings row when it exists', async () => {
        await Settings.create({ popupEnabled: true, popupImageUrl: 'https://example.com/p.png' });
        const result = await SettingsService.getSettings();
        expect(result?.popupEnabled).toBe(true);
        expect(result?.popupImageUrl).toBe('https://example.com/p.png');
    });
});

describe('SettingsService.updateSettings', () => {
    it('creates settings when none exist', async () => {
        const result = await SettingsService.updateSettings({ popupEnabled: true });
        expect(result?.popupEnabled).toBe(true);
        expect(await Settings.countDocuments()).toBe(1);
    });

    it('updates the existing row instead of creating a second one', async () => {
        await SettingsService.updateSettings({ popupEnabled: false });
        const result = await SettingsService.updateSettings({
            popupEnabled: true,
            maintenanceTitle: 'Down for maintenance',
        });
        expect(result?.popupEnabled).toBe(true);
        expect(result?.maintenanceTitle).toBe('Down for maintenance');
        expect(await Settings.countDocuments()).toBe(1);
    });

    it('persists social group links', async () => {
        const result = await SettingsService.updateSettings({
            maFacebookGroupLink: 'https://fb.com/ma-group',
            epWhatsappGroupLink: 'https://wa.me/ep-group',
        });
        expect(result?.maFacebookGroupLink).toBe('https://fb.com/ma-group');
        expect(result?.epWhatsappGroupLink).toBe('https://wa.me/ep-group');
    });
});

describe('SettingsService.getSocialGroupLinks', () => {
    it('returns an object with all four link keys as strings when no settings exist', async () => {
        const links = await SettingsService.getSocialGroupLinks();
        expect(typeof links.maFacebookGroupLink).toBe('string');
        expect(typeof links.maWhatsappGroupLink).toBe('string');
        expect(typeof links.epFacebookGroupLink).toBe('string');
        expect(typeof links.epWhatsappGroupLink).toBe('string');
    });

    it('prefers DB values over env defaults', async () => {
        await Settings.create({
            maFacebookGroupLink: 'https://fb.com/db-ma',
            maWhatsappGroupLink: 'https://wa.me/db-ma',
            epFacebookGroupLink: 'https://fb.com/db-ep',
            epWhatsappGroupLink: 'https://wa.me/db-ep',
        });
        const links = await SettingsService.getSocialGroupLinks();
        expect(links).toEqual({
            maFacebookGroupLink: 'https://fb.com/db-ma',
            maWhatsappGroupLink: 'https://wa.me/db-ma',
            epFacebookGroupLink: 'https://fb.com/db-ep',
            epWhatsappGroupLink: 'https://wa.me/db-ep',
        });
    });

    it('falls back per-field when only some DB values are set', async () => {
        await Settings.create({ maFacebookGroupLink: 'https://fb.com/only-ma' });
        const links = await SettingsService.getSocialGroupLinks();
        expect(links.maFacebookGroupLink).toBe('https://fb.com/only-ma');
        expect(typeof links.epWhatsappGroupLink).toBe('string');
    });
});
