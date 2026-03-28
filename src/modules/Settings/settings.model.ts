import { Schema, model } from 'mongoose';

export interface ISettings {
  popupEnabled?: boolean;
  popupImageUrl?: string;
  popupLink?: string;
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
}, {
  timestamps: true,
});



export const Settings = model<ISettings>('Settings', settingsSchema);