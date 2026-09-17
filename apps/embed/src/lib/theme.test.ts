import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT, resolveAccentColors, resolveTheme, textOnColor } from './theme';

describe('theme', () => {
  it('defaults to cherry with white text', () => {
    expect(DEFAULT_ACCENT).toBe('#d2042d');
    expect(textOnColor(DEFAULT_ACCENT)).toBe('#ffffff');
  });

  it('picks near black text only on pale accents', () => {
    expect(textOnColor('#ffff00')).toBe('#0a0a0a');
    expect(textOnColor('#f97316')).toBe('#ffffff');
  });

  it('renders white primary buttons for a black accent on the dark theme', () => {
    expect(resolveAccentColors('#0a0a0a', 'dark')).toMatchObject({
      accent: '#fafafa',
      foreground: '#0a0a0a',
    });
    expect(resolveAccentColors('#0a0a0a', 'light')).toMatchObject({
      accent: '#0a0a0a',
      foreground: '#ffffff',
    });
  });

  it('resolves system against the color scheme preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
