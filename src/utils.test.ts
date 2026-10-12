import { describe, expect, it } from 'vitest';
import { initialDraft, readDraft, validate } from './utils';
describe('generation input boundary', () => {
  it('rejects missing lyrics and seeds that cannot survive JSON exactly', () => {
    expect(validate({ ...initialDraft, lyrics: ' ' })).toBeTruthy();
    expect(validate({ ...initialDraft, lyrics: '[Verse]\n\n[Chorus]' })).toBeTruthy();
    expect(validate({ ...initialDraft, seed: Number.MAX_SAFE_INTEGER + 1 })).toBeTruthy();
    expect(validate({ ...initialDraft, seed: -1 })).toBeTruthy();
    expect(validate(initialDraft)).toBeNull();
  });
  it('recovers from invalid saved drafts instead of breaking startup', () => {
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => '{broken' },
      configurable: true,
    });
    expect(readDraft()).toEqual(initialDraft);
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => JSON.stringify({ ...initialDraft, cot: 'unknown' }) },
      configurable: true,
    });
    expect(readDraft().cot).toBe('full');
    Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true });
  });
});
