/**
 * Accent rules live in `@pockey/types` so the dashboard preview renders the
 * exact colors this modal uses (white text first, inverted accent when it
 * disappears into the surface).
 */
export {
  contrastRatio,
  DEFAULT_ACCENT,
  DEFAULT_APPEARANCE,
  isHexColor,
  normalizeHexColor,
  resolveAccentColors,
  textOnColor,
  type AccentColors,
  type Appearance,
  type ColorMode,
  type Palette,
  type Radius,
} from '@pockey/types';

export function resolveTheme(
  theme: 'light' | 'dark' | 'system',
  prefersDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
