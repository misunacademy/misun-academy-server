import env from '../../config/env.js';
import { Settings } from './settings.model.js';
import { ISettings } from './settings.interface.js';

export interface ISocialGroupLinks {
  maFacebookGroupLink: string;
  maWhatsappGroupLink: string;
  epFacebookGroupLink: string;
  epWhatsappGroupLink: string;
}

const getSettings = async (): Promise<ISettings | null> => {
  return await Settings.findOne().lean()
};

const updateSettings = async (payload: Partial<ISettings>): Promise<ISettings | null> => {
  // Atomic singleton upsert: findOne()+save() races into duplicate Settings
  // docs under concurrent first-writes, and getSettings() then reads a coin
  // flip. Strip undefined so partial updates can't null out stored values.
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (value !== undefined) set[key] = value;
  }
  return Settings.findOneAndUpdate({}, { $set: set }, { new: true, upsert: true, runValidators: true }).lean();
};

const getSocialGroupLinks = async (): Promise<ISocialGroupLinks> => {
  const settings = await Settings.findOne().lean<ISettings | null>();

  return {
    maFacebookGroupLink: settings?.maFacebookGroupLink || env.MA_FACEBOOK_GROUP_LINK || '',
    maWhatsappGroupLink: settings?.maWhatsappGroupLink || env.MA_WHATSAPP_GROUP_LINK || '',
    epFacebookGroupLink: settings?.epFacebookGroupLink || env.EP_FACEBOOK_GROUP_LINK || '',
    epWhatsappGroupLink: settings?.epWhatsappGroupLink || env.EP_WHATSAPP_GROUP_LINK || '',
  };
};

export const SettingsService = {
  getSettings,
  updateSettings,
  getSocialGroupLinks,
};