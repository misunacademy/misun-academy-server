import { describe, it, expect } from '@jest/globals';
import {
    extractYouTubeId,
    extractDriveId,
    normalizeVideoId,
    buildDrivePreviewUrl,
    buildYouTubeWatchUrl,
} from '../../utils/video.utils.js';

describe('video.utils', () => {
    describe('extractYouTubeId', () => {
        it.each([
            ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=10s', 'dQw4w9WgXcQ'],
            ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
            ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ'],
            ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
            // double-wrapped value from storing a full URL inside the videoId field
            [
                'https://www.youtube.com/watch?v=https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                'dQw4w9WgXcQ',
            ],
            ['  https://youtu.be/dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
        ])('extracts %s', (input, expected) => {
            expect(extractYouTubeId(input)).toBe(expected);
        });

        it.each([[''], [null], [undefined], ['not a video'], ['https://example.com']])(
            'returns null for %s',
            (input) => {
                expect(extractYouTubeId(input as unknown as string)).toBeNull();
            }
        );
    });

    describe('extractDriveId', () => {
        const driveId = '1a2b3c4d5e6f7g8h9i0jKlMnOpQrSt';
        it.each([
            [driveId, driveId],
            [`https://drive.google.com/file/d/${driveId}/view?usp=sharing`, driveId],
            [`https://drive.google.com/file/d/${driveId}/preview`, driveId],
            [`https://drive.google.com/open?id=${driveId}`, driveId],
        ])('extracts %s', (input, expected) => {
            expect(extractDriveId(input)).toBe(expected);
        });

        it('returns null for non-drive urls', () => {
            expect(extractDriveId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
        });
    });

    describe('normalizeVideoId', () => {
        it('strips a pasted youtube url down to the raw id', () => {
            expect(normalizeVideoId('youtube', 'https://youtu.be/dQw4w9WgXcQ?si=x')).toBe('dQw4w9WgXcQ');
        });

        it('strips a pasted drive url down to the raw id', () => {
            expect(
                normalizeVideoId(
                    'googledrive',
                    'https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9i0jKlMnOpQrSt/view'
                )
            ).toBe('1a2b3c4d5e6f7g8h9i0jKlMnOpQrSt');
        });

        it('leaves an already-raw id untouched', () => {
            expect(normalizeVideoId('youtube', 'dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        });
    });

    describe('builders', () => {
        it('builds an embeddable drive preview url (not /view)', () => {
            expect(buildDrivePreviewUrl('ABC')).toBe('https://drive.google.com/file/d/ABC/preview');
        });

        it('builds a youtube watch url', () => {
            expect(buildYouTubeWatchUrl('dQw4w9WgXcQ')).toBe(
                'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            );
        });
    });
});
