import { describe, it, expect } from 'vitest';

describe('test runner smoke test', () => {
    it('runs and can assert', () => {
        expect(1 + 1).toBe(2);
    });
});
