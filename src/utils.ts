import type { Draft } from './types';
export function duration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return '—:—';
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
export function bytes(value: number) {
  return `${(value / 1e9).toFixed(1)} GB`;
}
export function validate(draft: Draft) {
  if (!draft.title.trim()) return 'Give your song a title.';
  if (!draft.style.trim()) return 'Describe the sound you have in mind.';
  if (!draft.lyrics.trim()) return 'Add lyrics for your song.';
  if (!draft.lyrics.split('\n').some((line) => line.trim() && !/^\[[^\]]+\]$/.test(line.trim())))
    return 'Add at least one line of lyrics after the section tags.';
  if (!Number.isSafeInteger(draft.seed) || draft.seed < 0)
    return 'Use a positive whole number for the seed.';
  return null;
}
export const initialDraft: Draft = {
  title: 'Midnight Drive',
  style: 'Dreamy synth-pop, warm female vocal, analog synths, a driving bassline, English, 100 BPM',
  lyrics:
    '[Verse]\nCity lights are slipping by\nSilver lanes and open sky\nYou and I, nowhere to be\nJust a moment, endlessly\n\n[Chorus]\nNeon on my mind\nHolding on to what we find\nIn this midnight drive\nYou make the night feel alive',
  cot: 'full',
  seed: 831001,
  length: 'standard',
};
export function readDraft(): Draft {
  try {
    const data = JSON.parse(localStorage.getItem('maestro:draft:v1') || 'null');
    if (
      data &&
      typeof data.title === 'string' &&
      typeof data.style === 'string' &&
      typeof data.lyrics === 'string' &&
      ['full', 'melody', 'off'].includes(data.cot) &&
      ['sketch', 'standard', 'extended'].includes(data.length) &&
      Number.isSafeInteger(data.seed) &&
      data.seed >= 0
    )
      return data;
  } catch {}
  return { ...initialDraft };
}
