import { z } from 'zod';

// Stored URLs are rendered by frontends — plain strings would allow
// `javascript:`/overlong payloads (stored XSS). http(s) only, capped length.
const httpUrl = z.string().url().max(2048).refine(
  (v) => /^https?:\/\//i.test(v),
  { message: 'URL must start with http:// or https://' }
);

// Forms submit "" for "unset": coerce to undefined so partial saves don't
// 400 on empty URL fields (updateSettings also strips undefined server-side).
const emptyToUnset = (body: any) => {
  if (body && typeof body === 'object') {
    const b = { ...body };
    for (const key of [
      'popupImageUrl', 'popupLink',
      'maFacebookGroupLink', 'maWhatsappGroupLink',
      'epFacebookGroupLink', 'epWhatsappGroupLink',
    ]) {
      if (b[key] === '') delete b[key];
    }
    return b;
  }
  return body;
};

const updateSettings = z.object({
  body: z.preprocess(emptyToUnset, z.object({
    popupEnabled: z.boolean().optional(),
    popupImageUrl: httpUrl.optional(),
    popupLink: httpUrl.optional(),
    maintenanceEnabled: z.boolean().optional(),
    maintenanceTitle: z.string().max(200).optional(),
    maintenanceMessage: z.string().max(2000).optional(),
    maFacebookGroupLink: httpUrl.optional(),
    maWhatsappGroupLink: httpUrl.optional(),
    epFacebookGroupLink: httpUrl.optional(),
    epWhatsappGroupLink: httpUrl.optional(),
    homeWhyVideoUrl: z.string().max(2048).optional(),
    epHomeWhyVideoUrl: z.string().max(2048).optional(),
    maPaymentTutorialVideoUrl: z.string().max(2048).optional(),
    epPaymentTutorialVideoUrl: z.string().max(2048).optional(),
  })),
});

export const SettingsValidation = {
  updateSettings,
};
