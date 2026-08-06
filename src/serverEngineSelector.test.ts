import { describe, it, expect } from 'vitest';
import { shouldUseTypeScriptServer } from './serverEngineSelector';

describe('shouldUseTypeScriptServer', () => {
    it('returns true only for the exact string "typescript"', () => {
        expect(shouldUseTypeScriptServer('typescript')).toBe(true);
    });

    it('returns false for "csharp", undefined, null, or garbage values', () => {
        expect(shouldUseTypeScriptServer('csharp')).toBe(false);
        expect(shouldUseTypeScriptServer(undefined)).toBe(false);
        expect(shouldUseTypeScriptServer(null)).toBe(false);
        expect(shouldUseTypeScriptServer('TypeScript')).toBe(false);
        expect(shouldUseTypeScriptServer('')).toBe(false);
    });
});
