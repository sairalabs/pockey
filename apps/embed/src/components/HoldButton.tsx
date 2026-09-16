import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export const HOLD_MS = 1500;

/**
 * Hold to confirm: a clip-path fill runs 1.5s linear while pressed and snaps
 * back in 200ms ease-out on release. Works with pointer, Space and Enter.
 */
export function HoldButton({
  children,
  onComplete,
  disabled = false,
  icon,
}: {
  children: ReactNode;
  onComplete: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const hintId = useId();

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const start = () => {
    if (disabled || timer.current !== null) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onComplete();
    }, HOLD_MS);
  };

  const stop = () => {
    clear();
    setHolding(false);
  };

  const label = (
    <>
      {icon}
      <span>{children}</span>
    </>
  );

  return (
    <button
      type="button"
      disabled={disabled}
      data-holding={String(holding)}
      aria-describedby={hintId}
      className={clsx(
        'pk-hold pk-press relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-surface-2 px-4 text-[15px] font-medium text-fg select-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') stop();
      }}
      onBlur={stop}
    >
      {label}
      <span className="pk-hold-fill" aria-hidden="true">
        {label}
      </span>
      <span id={hintId} className="sr-only">
        Press and hold for 1.5 seconds
      </span>
    </button>
  );
}
