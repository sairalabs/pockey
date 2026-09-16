import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** 1px accent line at the bottom edge, like the Base stat cards. */
  accent?: boolean;
  /** Remove the default 20px padding. */
  flush?: boolean;
}

/**
 * Surface with a shadow-border ring instead of a border (better-ui surfaces).
 * Radius 16px. Nested rounded rows inside use 10px and are treated as their own
 * surface: with 20px padding the concentric formula would give a negative radius.
 */
export function Card({ accent = false, flush = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-card bg-surface shadow-border',
        'transition-[box-shadow] duration-150 ease-out hover:shadow-border-hover',
        !flush && 'p-5',
        accent &&
          'overflow-hidden after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-accent',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Lighter rounded row inside a card (`Home 0` rows in the reference). */
export function CardRow({ className, children, ...props }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn(
        'flex h-10 items-center justify-between rounded-[10px] bg-surface-2 px-3 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
