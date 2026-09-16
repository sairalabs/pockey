import { describe, expect, it } from 'vitest';
import { accentForeground, contrastRatio, resolveTheme } from './theme';

describe('theme', () => {
  it('picks near black on a bright yellow accent', () => {
    expect(accentForeground('#ffff00')).toBe('#0a0a0a');
  });

  it('picks white on the default violet accent', () => {
    expect(accentForeground('#7c3aed')).toBe('#ffffff');
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7c3aed', '#7c3aed')).toBeCloseTo(1, 5);
  });

  it('resolves system against the color scheme preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
