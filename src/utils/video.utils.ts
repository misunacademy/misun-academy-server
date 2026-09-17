const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

const clean = (v: string): string => v.trim().replace(/^["'<]+|["'>]+$/g, '').trim();

export function extractYouTubeId(input: string | null | undefined): string | null {
    if (!input) return null;
    let value = clean(String(input));
    if (!value) return null;
    if (YOUTUBE_ID_RE.test(value)) return value;

    const vParams = [...value.matchAll(/[?&]v=([A-Za-z0-9_-]{11})(?=[&#?]|$)/g)].map((m) => m[1]);
    if (vParams.length > 0) return vParams[vParams.length - 1];

    for (let depth = 0; depth < 2; depth++) {
        const vMatch = value.match(/[?&]v=([^&#?]+)/);
        if (vMatch) {
            const inner = decodeURIComponent(vMatch[1]);
            if (YOUTUBE_ID_RE.test(inner)) return inner;
            if (/^https?:\/\//i.test(inner) || inner.includes('youtu')) {
                if (/[?&]v=|\/(embed|shorts|live|v)\/|youtu\.be\//i.test(inner)) {
                    value = inner;
                    continue;
                }
                break;
            }
            const loose = inner.match(/[A-Za-z0-9_-]{11}/);
            if (loose) return loose[0];
        }
        break;
    }

    try {
        const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
        const u = new URL(hasScheme ? value : `https://${value}`);
        const v = u.searchParams.get('v');
        if (v) {
            const decoded = decodeURIComponent(v);
            if (YOUTUBE_ID_RE.test(decoded)) return decoded;
            const loose = decoded.match(/[A-Za-z0-9_-]{11}/);
            if (loose) return loose[0];
            if (/^https?:\/\//i.test(decoded)) {
                const nested = extractYouTubeId(decoded);
                if (nested) return nested;
            }
        }
        const segments = u.pathname.split('/').filter(Boolean);
        const markers = new Set(['embed', 'shorts', 'live', 'v', 'e']);
        for (let i = 0; i < segments.length; i++) {
            if (markers.has(segments[i]) && segments[i + 1]) {
                const candidate = segments[i + 1].split(/[?&#]/)[0];
                if (YOUTUBE_ID_RE.test(candidate)) return candidate;
                const loose = candidate.match(/[A-Za-z0-9_-]{11}/);
                if (loose) return loose[0];
            }
        }
        if (u.hostname.toLowerCase().includes('youtu.be') && segments.length > 0) {
            const candidate = segments[0].split(/[?&#]/)[0];
            if (YOUTUBE_ID_RE.test(candidate)) return candidate;
            const loose = candidate.match(/[A-Za-z0-9_-]{11}/);
            if (loose) return loose[0];
        }
    } catch {
        /* fall through */
    }

    const loose = value.match(/[A-Za-z0-9_-]{11}/);
    if (loose && (/youtu\.?be|youtube/i.test(value) || YOUTUBE_ID_RE.test(value))) return loose[0];
    return null;
}

export function extractDriveId(input: string | null | undefined): string | null {
    if (!input) return null;
    const value = clean(String(input));
    if (!value) return null;
    if (DRIVE_ID_RE.test(value) && value.length >= 15 && !value.includes('/') && !value.includes(' ')) {
        if (!YOUTUBE_ID_RE.test(value)) return value;
    }
    try {
        const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
        const u = new URL(hasScheme ? value : `https://${value}`);
        if (!u.hostname.toLowerCase().includes('drive.google')) return null;
        const fileMatch = u.pathname.match(/\/file\/d\/([^/?#]+)/);
        if (fileMatch?.[1]) return fileMatch[1];
        const idParam = u.searchParams.get('id');
        if (idParam && DRIVE_ID_RE.test(idParam)) return idParam;
    } catch {
        return null;
    }
    return null;
}

/**
 * Strip a pasted URL down to the raw id for storage.
 * Instructors constantly paste full watch / share / Drive links into the
 * "Video ID" field; without this the DB ends up with double-wrapped values
 * like `watch?v=<full-url>` which the player can never resolve (YouTube then
 * reports "This video is unavailable").
 */
export function normalizeVideoId(source: string | undefined, raw: string | null | undefined): string {
    if (!raw) return '';
    const value = clean(String(raw));
    if (!value) return '';
    if (source === 'googledrive') {
        return extractDriveId(value) ?? value;
    }
    return extractYouTubeId(value) ?? value;
}

export function buildYouTubeWatchUrl(videoId: string): string {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/** `/preview` (not `/view`) is the embeddable Drive URL for iframes. */
export function buildDrivePreviewUrl(driveId: string): string {
    return `https://drive.google.com/file/d/${driveId}/preview`;
}
