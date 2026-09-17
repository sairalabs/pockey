import Link from 'next/link';
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

interface SizeSpec {
  base: string;
  /** Label only. */
  text: string;
  /** Icons on both sides. */
  icon: string;
  /** Leading icon: 2px less padding on the icon side (better-ui optical alignment). */
  iconStart: string;
  iconEnd: string;
}

// Every class is written in full: Tailwind scans the source as text, so a class
// name built by concatenation at runtime is never generated.
const sizes: Record<ButtonSize, SizeSpec> = {
  sm: {
    base: 'h-8 gap-1.5 text-[13px]',
    text: 'px-3',
    icon: 'px-2.5',
    iconStart: 'ps-2.5 pe-3',
    iconEnd: 'ps-3 pe-2.5',
  },
  md: {
    base: 'h-10 gap-2 text-sm',
    text: 'px-4',
    icon: 'px-3.5',
    iconStart: 'ps-3.5 pe-4',
    iconEnd: 'ps-4 pe-3.5',
  },
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  static?: boolean;
  hasIconStart?: boolean;
  hasIconEnd?: boolean;
  className?: string | undefined;
}

/** Shared between `Button` and `ButtonLink` so a link never drifts from a button. */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  static: isStatic = false,
  hasIconStart = false,
  hasIconEnd = false,
  className,
}: ButtonClassOptions): string {
  const s = sizes[size];
  const padding =
    hasIconStart && hasIconEnd
      ? s.icon
      : hasIconStart
        ? s.iconStart
        : hasIconEnd
          ? s.iconEnd
          : s.text;

  return cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-pill',
    'transition-[transform,background-color,box-shadow,color] duration-150 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    s.base,
    padding,
    variants[variant],
    !isStatic && tapScale,
    className,
  );
}

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
  return (
    <button
      type={type}
      className={buttonClasses({
        variant,
        size,
        static: isStatic,
        hasIconStart: iconStart !== undefined,
        hasIconEnd: iconEnd !== undefined,
        className,
      })}
      {...props}
    >
      {iconStart}
      {children}
      {iconEnd}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentPropsWithRef<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  static?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
}

/** Same pill, but a real link: used where the action is a navigation. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  static: isStatic = false,
  iconStart,
  iconEnd,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses({
        variant,
        size,
        static: isStatic,
        hasIconStart: iconStart !== undefined,
        hasIconEnd: iconEnd !== undefined,
        className,
      })}
      {...props}
    >
      {iconStart}
      {children}
      {iconEnd}
    </Link>
  );
}
