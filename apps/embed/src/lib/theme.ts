/**
 * Accent rules live in `@pocketkey/types` so the dashboard preview renders the
 * exact colors this modal uses (white text first, inverted accent when it
 * disappears into the surface).
 */
export {
  contrastRatio,
  DEFAULT_ACCENT,
  isHexColor,
  normalizeHexColor,
  resolveAccentColors,
  textOnColor,
  type AccentColors,
  type ColorMode,
} from '@pocketkey/types';

export function resolveTheme(
  theme: 'light' | 'dark' | 'system',
  prefersDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
