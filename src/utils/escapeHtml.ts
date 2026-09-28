// Escape text for interpolation into HTML email templates. User-controlled
// fields (names, reasons, admin-composed subjects/messages) must never be
// injected raw — email clients render script-capable HTML.
export const escapeHtml = (value: unknown): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
