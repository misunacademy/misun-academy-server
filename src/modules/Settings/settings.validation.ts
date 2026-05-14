import { z } from 'zod';

const updateSettings = z.object({
  body: z.object({
    popupEnabled: z.boolean().optional(),
    popupImageUrl: z.string().optional(),
    popupLink: z.string().optional(),
    maintenanceEnabled: z.boolean().optional(),
    maintenanceTitle: z.string().optional(),
    maintenanceMessage: z.string().optional(),
  }),
});

export const SettingsValidation = {
  updateSettings,
};