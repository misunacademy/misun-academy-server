import { Settings } from './settings.model.js';
import { ISettings } from './settings.interface.js';

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

export const SettingsService = {
  getSettings,
  updateSettings,
};