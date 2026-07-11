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
  return await Settings.findOne()
};

const updateSettings = async (payload: Partial<ISettings>): Promise<ISettings | null> => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = new Settings(payload);
  } else {
    Object.assign(settings, payload);
  }
  return await settings.save();
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