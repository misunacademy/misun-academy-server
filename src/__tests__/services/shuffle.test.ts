import { describe, it, expect } from '@jest/globals';
import { shuffleArray } from '../../modules/Quiz/attempt.service.js';

describe('shuffleArray', () => {
    it('returns a permutation: same length, same multiset, no duplicates or drops', () => {
        const input = [1, 2, 3, 4, 5, 6, 7, 8];
        for (let run = 0; run < 50; run++) {
            const out = shuffleArray(input);
            expect(out).toHaveLength(input.length);
            expect([...out].sort((a, b) => a - b)).toEqual(input);
        }
    });

    it('does not mutate the input and returns a new array', () => {
        const input = ['a', 'b', 'c'];
        const out = shuffleArray(input);
        expect(input).toEqual(['a', 'b', 'c']);
        expect(out).not.toBe(input);
    });

    it('actually shuffles across positions over many runs', () => {
        const seenAtZero = new Set<number>();
        for (let run = 0; run < 200; run++) {
            seenAtZero.add(shuffleArray([1, 2, 3, 4, 5])[0]);
        }
        // P(all 200 runs landing the same value) = (1/5)^200 ≈ 0
        expect(seenAtZero.size).toBeGreaterThan(1);
    });

    it('handles empty and single-element arrays', () => {
        expect(shuffleArray([])).toEqual([]);
        expect(shuffleArray([42])).toEqual([42]);
    });
});
