import { describe, it, expect } from '@jest/globals';
import {
    ChatService,
    resetGroqClient,
    invalidateContextCache,
} from '../../modules/Chat/chat.service.js';

const expectCode = async (fn: () => Promise<unknown>, code: string, statusCode: number) => {
    let threw = false;
    try {
        await fn();
    } catch (err: any) {
        threw = true;
        expect(err.code).toBe(code);
        expect(err.statusCode).toBe(statusCode);
    }
    expect(threw).toBe(true);
};

describe('ChatService.chat input validation (no Groq network)', () => {
    it('rejects an empty messages array', async () => {
        await expectCode(() => ChatService.chat([]), 'INVALID_INPUT', 400);
    });

    it('rejects a non-array payload', async () => {
        await expectCode(() => ChatService.chat('hello' as any), 'INVALID_INPUT', 400);
    });

    it('rejects when all messages are blank after sanitization', async () => {
        let threw = false;
        try {
            await ChatService.chat([{ role: 'user', content: '   ' }]);
        } catch (err: any) {
            threw = true;
            expect(err.code).toBe('INVALID_INPUT');
            expect(err.statusCode).toBe(400);
            expect(err.message).toMatch(/No valid messages/i);
        }
        expect(threw).toBe(true);
    });

    it('rejects when no message has a valid role', async () => {
        await expectCode(
            () => ChatService.chat([{ role: 'system', content: 'hello' } as any]),
            'INVALID_INPUT',
            400
        );
    });

    it('filters out invalid entries but keeps the valid ones (validation passes)', async () => {
        // Validation must pass here (invalid entries dropped); the call then
        // proceeds to context/Groq. Without a GROQ key it throws MISSING_API_KEY;
        // with a key it would attempt network. Either way it must NOT throw
        // INVALID_INPUT, proving sanitization kept the valid message.
        try {
            await ChatService.chat([
                { role: 'system', content: 'ignored' } as any,
                { role: 'user', content: '   ' },
                { role: 'user', content: 'What courses do you offer?' },
            ]);
            // A live Groq key would return a reply; accept success too.
            expect(true).toBe(true);
        } catch (err: any) {
            expect(err.code).not.toBe('INVALID_INPUT');
        }
    });
});

describe('ChatService cache/client helpers', () => {
    it('resetGroqClient and invalidateContextCache are safe no-ops', () => {
        expect(() => resetGroqClient()).not.toThrow();
        expect(() => invalidateContextCache()).not.toThrow();
    });
});
