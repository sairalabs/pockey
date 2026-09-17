import { describe, expect, it } from 'vitest';
import {
  apcaContrast,
  contrastRatio,
  DARK_TEXT,
  DEFAULT_ACCENT,
  normalizeHexColor,
  resolveAccentColors,
  textOnColor,
  WHITE_TEXT,
} from './color.js';

describe('textOnColor', () => {
  it('keeps white text on saturated and mid tone colors', () => {
    for (const color of [
      DEFAULT_ACCENT,
      '#0052ff',
      '#16a34a',
      '#f97316',
      '#ef4444',
      '#f472b6',
      '#14b8a6',
    ]) {
      expect(textOnColor(color), color).toBe(WHITE_TEXT);
    }
  });

  it('switches to dark text only on pale colors', () => {
    for (const color of ['#ffffff', '#facc15', '#22d3ee', '#a3e635', '#6ee7b7', '#22c55e']) {
      expect(textOnColor(color), color).toBe(DARK_TEXT);
    }
  });

  it('matches reference contrasts', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(Math.abs(apcaContrast('#ffffff', '#000000'))).toBeGreaterThan(105);
    expect(apcaContrast('#ffffff', '#ffffff')).toBe(0);
  });
});

describe('resolveAccentColors', () => {
  it('uses the accent as is when it stands out from the surface', () => {
    expect(resolveAccentColors(DEFAULT_ACCENT, 'dark')).toEqual({
      accent: DEFAULT_ACCENT,
      foreground: WHITE_TEXT,
      inverted: false,
    });
  });

  it('turns a black accent into white buttons with dark text on the dark theme', () => {
    expect(resolveAccentColors('#0a0a0a', 'dark')).toEqual({
      accent: '#fafafa',
      foreground: DARK_TEXT,
      inverted: true,
    });
    expect(resolveAccentColors('#1c1c1c', 'dark').inverted).toBe(true);
  });

  it('keeps a black accent on the light theme and inverts a white one', () => {
    expect(resolveAccentColors('#0a0a0a', 'light')).toEqual({
      accent: '#0a0a0a',
      foreground: WHITE_TEXT,
      inverted: false,
    });
    expect(resolveAccentColors('#ffffff', 'light')).toEqual({
      accent: '#0a0a0a',
      foreground: WHITE_TEXT,
      inverted: true,
    });
  });

  it('falls back to the default accent on invalid input', () => {
    expect(resolveAccentColors('not a color', 'light').accent).toBe(DEFAULT_ACCENT);
  });
});

describe('normalizeHexColor', () => {
  it('accepts the usual ways people paste colors', () => {
    expect(normalizeHexColor('#D2042D')).toBe('#d2042d');
    expect(normalizeHexColor('d2042d')).toBe('#d2042d');
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor(' fff ')).toBe('#ffffff');
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('red')).toBeNull();
  });
});
