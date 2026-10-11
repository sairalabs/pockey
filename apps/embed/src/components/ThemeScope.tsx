import type { Appearance, Palette } from '@pockey/types';
import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { resolveAccentColors, resolveTheme } from '../lib/theme';
import { useMediaQuery } from './hooks';

/** Palette key to CSS variable. Anything the developer leaves out keeps our value. */
const VARIABLES: Record<keyof Palette, string> = {
  surface: '--surface',
  surfaceAlt: '--surface-2',
  surfaceHover: '--surface-3',
  text: '--text',
  textMuted: '--text-2',
  textSubtle: '--text-3',
  danger: '--danger',
  overlay: '--backdrop',
};

function paletteStyle(
  palette: Palette | undefined,
  overlayOpacity: number | undefined,
): Record<string, string> {
  const style: Record<string, string> = {};
  if (!palette) return style;
  for (const [key, variable] of Object.entries(VARIABLES)) {
    const value = palette[key as keyof Palette];
    if (!value) continue;
    style[variable] =
      key === 'overlay' && overlayOpacity !== undefined
        ? `color-mix(in oklch, ${value} ${Math.round(overlayOpacity * 100)}%, transparent)`
        : value;
  }
  return style;
}

/**
 * Turns an app's appearance into the CSS variables every screen reads. Colors are
 * per mode, so a developer can style light and dark separately, and anything they
 * leave out falls back to the Pockey palette for that mode.
 */
export function ThemeScope({
  appearance,
  className,
  children,
}: {
  appearance: Appearance;
  className?: string;
  children: ReactNode;
}) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = resolveTheme(appearance.theme, prefersDark);
  const colors = resolveAccentColors(appearance.accent, mode);
  const style = {
    '--accent': colors.accent,
    '--accent-fg': colors.foreground,
    ...(appearance.font ? { '--pk-font': appearance.font } : {}),
    ...paletteStyle(
      mode === 'dark' ? appearance.dark : appearance.light,
      appearance.overlayOpacity,
    ),
  } as CSSProperties;
  return (
    <div
      className={clsx('pk-theme', className)}
      data-theme={mode}
      data-radius={appearance.radius}
      style={style}
    >
      {children}
    </div>
  );
}
