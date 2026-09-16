export const DEFAULT_ACCENT = '#7c3aed';
const LIGHT_FG = '#ffffff';
const DARK_FG = '#0a0a0a';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a `#rrggbb` color. */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return 0;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) =>
    channel(Number.parseInt(part ?? '0', 16)),
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near black, whichever contrasts more with the accent. */
export function accentForeground(accent: string): typeof LIGHT_FG | typeof DARK_FG {
  return contrastRatio(accent, LIGHT_FG) >= contrastRatio(accent, DARK_FG) ? LIGHT_FG : DARK_FG;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function resolveTheme(
  theme: 'light' | 'dark' | 'system',
  prefersDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
