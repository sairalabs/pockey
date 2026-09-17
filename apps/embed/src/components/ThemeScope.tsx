import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { resolveAccentColors, resolveTheme } from '../lib/theme';
import { useMediaQuery } from './hooks';

export function ThemeScope({
  theme,
  accent,
  className,
  children,
}: {
  theme: 'light' | 'dark' | 'system';
  accent: string;
  className?: string;
  children: ReactNode;
}) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = resolveTheme(theme, prefersDark);
  const colors = resolveAccentColors(accent, mode);
  const style = {
    '--accent': colors.accent,
    '--accent-fg': colors.foreground,
  } as CSSProperties;
  return (
    <div className={clsx('pk-theme', className)} data-theme={mode} style={style}>
      {children}
    </div>
  );
}
