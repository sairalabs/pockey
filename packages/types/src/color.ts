/**
 * Accent color rules shared by the embed modal and the dashboard preview, so a
 * developer sees exactly what their users will see.
 *
 * 1. Text on an accent fill prefers white. It switches to near black only when
 *    white would not be readable, measured with APCA (Lc), which models light
 *    text on saturated colors far better than WCAG 2 ratios do.
 * 2. When the accent melts into the modal surface (black on the dark theme,
 *    white on the light theme), the accent is replaced by the theme text color,
 *    so primary buttons stay visible: white buttons on dark, black on light.
 */

export const DEFAULT_ACCENT = '#4132ec';

export type ColorMode = 'light' | 'dark';

/** Modal surfaces and text per theme. Keep in sync with `apps/embed/src/styles.css`. */
export const THEME_SURFACE: Record<ColorMode, string> = { light: '#ffffff', dark: '#101010' };
export const THEME_TEXT: Record<ColorMode, string> = { light: '#0a0a0a', dark: '#fafafa' };

export const WHITE_TEXT = '#ffffff';
export const DARK_TEXT = '#0a0a0a';
export type TextOnColor = typeof WHITE_TEXT | typeof DARK_TEXT;

/**
 * White text is used from this APCA lightness contrast upward. Lc 50 keeps
 * medium weight button labels readable while leaving white on most saturated
 * brand colors (cherry, blue, green 600, orange, pink, teal). Pale colors
 * (yellow, cyan, lime, mint, white) fall below and get dark text.
 */
export const WHITE_TEXT_MIN_LC = 50;

/** Below this WCAG ratio between accent and surface, the accent is inverted. */
export const ACCENT_SURFACE_MIN_RATIO = 1.35;

const HEX6 = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
  return HEX6.test(value);
}

/** Accepts `#rrggbb`, `rrggbb`, `#rgb` or `rgb` in any case. Returns lowercase `#rrggbb` or null. */
export function normalizeHexColor(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

function rgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex) ?? '#000000';
  return [1, 3, 5].map((start) => Number.parseInt(normalized.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** APCA 0.0.98G-4g lightness contrast of `text` on `background`. Signed: negative for light text. */
export function apcaContrast(text: string, background: string): number {
  const screenY = (hex: string) => {
    const [r, g, b] = rgb(hex).map((value) => (value / 255) ** 2.4) as [number, number, number];
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    return y > 0.022 ? y : y + (0.022 - y) ** 1.414;
  };
  const t = screenY(text);
  const bg = screenY(background);
  if (bg > t) {
    const s = (bg ** 0.56 - t ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (bg ** 0.65 - t ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/** White whenever it is readable, near black otherwise. */
export function textOnColor(background: string): TextOnColor {
  return Math.abs(apcaContrast(WHITE_TEXT, background)) >= WHITE_TEXT_MIN_LC
    ? WHITE_TEXT
    : DARK_TEXT;
}

export interface AccentColors {
  /** Fill for primary buttons, logo tiles, focus rings. */
  accent: string;
  /** Text and icons on top of `accent`. */
  foreground: TextOnColor;
  /** True when the configured accent was replaced because it disappeared into the surface. */
  inverted: boolean;
}

export function resolveAccentColors(accent: string, mode: ColorMode): AccentColors {
  const color = normalizeHexColor(accent) ?? DEFAULT_ACCENT;
  if (contrastRatio(color, THEME_SURFACE[mode]) < ACCENT_SURFACE_MIN_RATIO) {
    const inverse = THEME_TEXT[mode];
    return { accent: inverse, foreground: textOnColor(inverse), inverted: true };
  }
  return { accent: color, foreground: textOnColor(color), inverted: false };
}
