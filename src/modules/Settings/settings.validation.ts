import { z } from 'zod';

const updateSettings = z.object({
  body: z.object({
    popupEnabled: z.boolean().optional(),
    popupImageUrl: z.string().optional(),
    popupLink: z.string().optional(),
  }),
});

export const SettingsValidation = {
  updateSettings,
};