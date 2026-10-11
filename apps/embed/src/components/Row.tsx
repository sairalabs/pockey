import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface RowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Brand mark, pinned right. */
  mark?: ReactNode;
  /** Quiet text between the label and the mark (chain family, "installed"). */
  note?: ReactNode;
}

/**
 * A choice in a list: label on the left, brand mark on the right. One filled
 * surface, no outline, so a row reads as a block rather than a box.
 */
export function Row({ mark, note, className, children, type = 'button', ...rest }: RowProps) {
  return (
    <button
      type={type}
      className={clsx(
        'pk-press flex h-[60px] w-full items-center gap-3 rounded-[var(--pk-radius-row)] bg-surface-2 px-4 text-left',
        'hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-fg">{children}</span>
      {note ? <span className="shrink-0 text-[13px] text-fg-3">{note}</span> : null}
      {mark ? (
        <span className="flex size-10 shrink-0 items-center justify-center">{mark}</span>
      ) : null}
    </button>
  );
}
