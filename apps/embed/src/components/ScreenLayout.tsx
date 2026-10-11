import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { ChevronLeft, Info, X } from './icons';

interface ScreenLayoutProps {
  titleId: string;
  /**
   * What the screen is about. It sits big in the body under the mark, or, when a
   * screen has no mark to carry it, alone in the header bar between the buttons.
   */
  title: ReactNode;
  /** Header bar name for a screen whose body already carries the title. */
  label?: ReactNode;
  subtitle?: ReactNode;
  /** Logo or icon above the title. */
  media?: ReactNode;
  /** Extra header content under the subtitle (origin chip). */
  meta?: ReactNode;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  /** Shows the help button on the left when there is nothing to go back to. */
  onHelp?: (() => void) | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  /** Live region content under the body (errors). */
  status?: ReactNode;
}

/**
 * Header bar, body, footer. The bar keeps its two corner buttons and a centred
 * screen name; the body carries the mark, the heading and whatever the screen
 * asks of the user. Only the body scrolls when the dialog hits its max height.
 */
export function ScreenLayout({
  titleId,
  title,
  label,
  subtitle,
  media,
  meta,
  onBack,
  onClose,
  onHelp,
  children,
  footer,
  status,
}: ScreenLayoutProps) {
  // A screen with a mark carries its title under it; one without puts the title in the bar.
  const titleInBar = !media;
  return (
    <div className="pk-screen">
      <header className="shrink-0">
        <div className="-mx-1 flex h-10 items-center justify-between gap-2">
          {onBack ? (
            <IconButton label="Back" onClick={onBack}>
              <ChevronLeft size={20} aria-hidden="true" />
            </IconButton>
          ) : onHelp ? (
            <IconButton label="What is a wallet?" onClick={onHelp}>
              <Info size={18} aria-hidden="true" />
            </IconButton>
          ) : (
            <span className="size-10 shrink-0" />
          )}
          {titleInBar ? (
            <h2
              id={titleId}
              className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold text-fg"
            >
              {title}
            </h2>
          ) : (
            <span className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold text-fg">
              {label}
            </span>
          )}
          {onClose ? (
            <IconButton label="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </IconButton>
          ) : (
            <span className="size-10 shrink-0" />
          )}
        </div>
        {media || subtitle || meta ? (
          <div
            className={clsx('flex flex-col items-center px-2 text-center', media ? 'pt-3' : null)}
          >
            {media ? <div className="mb-5">{media}</div> : null}
            {media ? (
              <h2
                id={titleId}
                className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-balance text-fg"
              >
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-1.5 text-[15px] leading-[22px] text-pretty text-fg-2">{subtitle}</p>
            ) : null}
            {meta ? <div className="mt-3">{meta}</div> : null}
          </div>
        ) : null}
      </header>
      {children ? <div className="pk-screen-body">{children}</div> : null}
      <div aria-live="polite" className="shrink-0">
        {status}
      </div>
      {footer ? <div className="mt-6 shrink-0">{footer}</div> : null}
    </div>
  );
}

/** The mark at the top of a screen. Flat brand: the icon stands on its own, no tile behind it. */
export function ScreenIcon({
  children,
  tone = 'neutral',
  size = 48,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'danger';
  size?: 48 | 64;
}) {
  return (
    <div
      className={clsx(
        'pk-screen-mark flex items-center justify-center',
        size === 64 ? 'size-16' : 'size-12',
        tone === 'neutral' && 'text-fg',
        tone === 'accent' && 'text-accent',
        tone === 'danger' && 'text-danger',
      )}
    >
      {children}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-center text-[13px] leading-5 text-danger">{children}</p>;
}

export function OriginChip({ origin }: { origin: string }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center rounded-full bg-surface-2 px-3 text-[13px] font-medium text-fg-2">
      <span className="truncate">{origin}</span>
    </span>
  );
}
