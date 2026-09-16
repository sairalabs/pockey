import { clsx } from 'clsx';
import type { CSSProperties, ReactNode } from 'react';
import { accentForeground, DEFAULT_ACCENT, isHexColor, resolveTheme } from '../lib/theme';
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
  const color = isHexColor(accent) ? accent : DEFAULT_ACCENT;
  const style = {
    '--accent': color,
    '--accent-fg': accentForeground(color),
  } as CSSProperties;
  return (
    <div
      className={clsx('pk-theme', className)}
      data-theme={resolveTheme(theme, prefersDark)}
      style={style}
    >
      {children}
    </div>
  );
}
