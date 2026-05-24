import { Schema, model } from 'mongoose';

export interface ISettings {
  popupEnabled?: boolean;
  popupImageUrl?: string;
  popupLink?: string;
  maintenanceEnabled?: boolean;
  maintenanceTitle?: string;
  maintenanceMessage?: string;
  maFacebookGroupLink?: string;
  maWhatsappGroupLink?: string;
  epFacebookGroupLink?: string;
  epWhatsappGroupLink?: string;
}

const settingsSchema = new Schema<ISettings>({
  popupEnabled: {
    type: Boolean,
    default: false,
  },
  popupImageUrl: {
    type: String,
    default: '',
  },
  popupLink: {
    type: String,
    default: '',
  },
  maintenanceEnabled: {
    type: Boolean,
    default: false,
  },
  maintenanceTitle: {
    type: String,
    default: '',
  },
  maintenanceMessage: {
    type: String,
    default: '',
  },
  maFacebookGroupLink: {
    type: String,
    default: '',
  },
  maWhatsappGroupLink: {
    type: String,
    default: '',
  },
  epFacebookGroupLink: {
    type: String,
    default: '',
  },
  epWhatsappGroupLink: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});



export const Settings = model<ISettings>('Settings', settingsSchema);