import { clsx } from 'clsx';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import type { Nav } from '../lib/state';
import {
  backdropVariants,
  panelVariants,
  screenVariants,
  type DialogVariant,
  type PresenceCustom,
  type ScreenCustom,
} from './motion';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Keeps the container height on the content (ResizeObserver, 200ms ease-out)
 * while screens cross-fade: the outgoing one pops out of the flow and fades in
 * 100ms, the incoming one slides 8px and unblurs in 150ms.
 */
export function ScreenStack({
  nav,
  reduced,
  children,
}: {
  nav: Nav;
  reduced: boolean;
  children: ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ height: number; animate: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      setSize((previous) =>
        previous?.height === height ? previous : { height, animate: previous !== null },
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const custom: ScreenCustom = { direction: nav.direction, opacityOnly: reduced || nav.keyboard };

  return (
    <div
      className="relative overflow-hidden"
      style={{
        height: size ? size.height : undefined,
        transition: size?.animate && !reduced ? 'height 200ms var(--ease-out)' : undefined,
      }}
    >
      <div ref={measureRef} className="relative">
        <AnimatePresence initial={false} mode="popLayout" custom={custom}>
          <m.div
            key={nav.key}
            data-screen-key={nav.key}
            custom={custom}
            variants={screenVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {children}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function DialogPanel({
  variant,
  labelledBy,
  nav,
  reduced,
  keyboardClose = false,
  children,
  ref,
  onKeyDown,
}: {
  variant: DialogVariant;
  labelledBy: string;
  nav: Nav;
  reduced: boolean;
  keyboardClose?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const custom: PresenceCustom = { variant, reduced, keyboard: keyboardClose };
  return (
    <m.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      data-variant={variant}
      data-testid="pk-dialog"
      custom={custom}
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      onKeyDown={onKeyDown}
      className={clsx(
        'relative flex flex-col overflow-hidden bg-surface text-fg shadow-[var(--shadow-panel)] outline-none',
        variant === 'dialog'
          ? 'w-[380px] max-w-full rounded-[var(--pk-radius-panel)]'
          : 'w-full rounded-t-[var(--pk-radius-panel)]',
      )}
    >
      <ScreenStack nav={nav} reduced={reduced}>
        {children}
      </ScreenStack>
    </m.div>
  );
}

function focusables(panel: HTMLElement, navKey: number): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    const screen = element.closest('[data-screen-key]');
    return !screen || screen.getAttribute('data-screen-key') === String(navKey);
  });
}

export function EmbedDialog({
  open,
  variant,
  nav,
  labelledBy,
  keyboardClose,
  onDismiss,
  onExitComplete,
  children,
}: {
  open: boolean;
  variant: DialogVariant;
  nav: Nav;
  labelledBy: string;
  keyboardClose: boolean;
  onDismiss: () => void;
  onExitComplete: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedOnLayer = useRef(false);
  const custom: PresenceCustom = { variant, reduced, keyboard: keyboardClose };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onDismiss]);

  // Focus the first field of each new screen, or the dialog itself.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const screen = panel.querySelector(`[data-screen-key="${String(nav.key)}"]`);
      const active = document.activeElement;
      if (screen && active instanceof HTMLElement && screen.contains(active)) return;
      const target = screen?.querySelector<HTMLElement>('[data-autofocus]');
      (target ?? panel).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, nav.key]);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = focusables(panel, nav.key);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence custom={custom} onExitComplete={onExitComplete}>
      {open ? (
        <m.div
          key="backdrop"
          aria-hidden="true"
          className="fixed inset-0 bg-[var(--backdrop)] backdrop-blur-[4px]"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        />
      ) : null}
      {open ? (
        <div
          key="layer"
          className={clsx(
            'fixed inset-0 flex justify-center overflow-hidden',
            variant === 'dialog' ? 'items-center p-4' : 'items-end',
          )}
          onPointerDown={(event) => {
            pressedOnLayer.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (pressedOnLayer.current && event.target === event.currentTarget) onDismiss();
            pressedOnLayer.current = false;
          }}
        >
          <DialogPanel
            ref={panelRef}
            variant={variant}
            labelledBy={labelledBy}
            nav={nav}
            reduced={reduced}
            keyboardClose={keyboardClose}
            onKeyDown={trapFocus}
          >
            {children}
          </DialogPanel>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
