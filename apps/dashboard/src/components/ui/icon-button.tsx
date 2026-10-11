import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends ComponentPropsWithRef<'button'> {
  /** Required: icon-only buttons have no visible text. */
  'aria-label': string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'outline';
  static?: boolean;
}

/** Round icon button. Hit area is 32px (sm) or 36px (md), never smaller. */
export function IconButton({
  size = 'md',
  variant = 'ghost',
  static: isStatic = false,
  className,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full text-fg-2',
        'transition-[transform,background-color,color,box-shadow] duration-150 ease-out',
        'hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
        '[&_svg]:shrink-0',
        size === 'sm' ? 'size-8 [&_svg]:size-4' : 'size-9 [&_svg]:size-5',
        variant === 'outline' && 'bg-surface-2',
        !isStatic && 'active:not-disabled:scale-[0.96]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
