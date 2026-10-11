import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import { Swap } from './Swap';

type Variant = 'primary' | 'secondary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** 20px icon pinned to the left, the label stays optically centered. */
  icon?: ReactNode;
  /** Cross-fades the label to a spinner without changing the width. */
  pending?: boolean;
  /** Disables the press scale. */
  static?: boolean;
  testId?: string;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
};

export function Button({
  variant = 'secondary',
  icon,
  pending = false,
  static: isStatic = false,
  testId,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-testid={testId}
      disabled={disabled}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      className={clsx(
        'relative inline-flex h-12 w-full items-center justify-center rounded-[var(--pk-radius-control)] px-4 text-[15px] font-medium select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        !isStatic && 'pk-press',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span className="pointer-events-none absolute top-1/2 left-4 flex size-5 -translate-y-1/2 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <Swap
        swapped={pending}
        from={<span className="truncate">{children}</span>}
        to={<Spinner size={18} />}
      />
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

/** 40px hit area, 32px visual. */
export function IconButton({
  label,
  children,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        'pk-press pk-icon-btn group inline-flex size-10 shrink-0 items-center justify-center rounded-full text-fg-2 hover:text-fg',
        className,
      )}
      {...rest}
    >
      <span className="flex size-8 items-center justify-center rounded-full group-hover:bg-surface-2">
        {children}
      </span>
    </button>
  );
}
