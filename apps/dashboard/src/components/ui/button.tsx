import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the scale(0.96) press feedback (better-ui `static` pattern). */
  static?: boolean;
  /** Icon rendered before the label. Pass `strokeWidth={2}` next to medium text. */
  iconStart?: ReactNode;
  /** Icon rendered after the label. */
  iconEnd?: ReactNode;
}

const tapScale = 'active:not-disabled:scale-[0.96]';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-white text-black font-medium hover:bg-[#e6e6e6]',
  secondary:
    'bg-surface-2 text-fg font-medium shadow-border hover:bg-surface-3 hover:shadow-border-hover',
  ghost: 'bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg',
  danger:
    'bg-transparent text-danger font-medium shadow-[0_0_0_1px_var(--danger)] hover:bg-danger/10',
};

const sizes: Record<ButtonSize, { base: string; text: string; icon: string }> = {
  sm: { base: 'h-8 gap-1.5 text-[13px]', text: 'px-3', icon: 'px-2.5' },
  md: { base: 'h-10 gap-2 text-sm', text: 'px-4', icon: 'px-3.5' },
};

/**
 * Pill button. Optical alignment per better-ui: the icon side gets 2px less
 * padding than the text side so the icon does not look pushed out.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  static: isStatic = false,
  iconStart,
  iconEnd,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const s = sizes[size];
  const padding =
    iconStart && iconEnd
      ? s.icon
      : iconStart
        ? `ps-${size === 'sm' ? '2.5' : '3.5'} pe-${size === 'sm' ? '3' : '4'}`
        : iconEnd
          ? `ps-${size === 'sm' ? '3' : '4'} pe-${size === 'sm' ? '2.5' : '3.5'}`
          : s.text;

  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-pill',
        'transition-[transform,background-color,box-shadow,color] duration-150 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        s.base,
        padding,
        variants[variant],
        !isStatic && tapScale,
        className,
      )}
      {...props}
    >
      {iconStart}
      {children}
      {iconEnd}
    </button>
  );
}
