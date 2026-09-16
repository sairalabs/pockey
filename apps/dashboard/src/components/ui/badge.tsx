import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  tone?: 'neutral' | 'accent' | 'danger';
}

/** Chip like `Owner` or a count next to a title. */
export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-pill px-2.5 text-xs font-medium num',
        tone === 'neutral' && 'bg-surface-2 text-fg-2 shadow-border',
        tone === 'accent' && 'bg-accent/15 text-[#7ea3ff]',
        tone === 'danger' && 'bg-danger/10 text-danger',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
