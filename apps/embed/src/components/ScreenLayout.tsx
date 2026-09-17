import { clsx } from 'clsx';
import { ChevronLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button';

interface ScreenLayoutProps {
  titleId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Logo or icon tile above the title. */
  media?: ReactNode;
  /** Extra header content under the subtitle (origin chip). */
  meta?: ReactNode;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  /** Live region content under the body (errors). */
  status?: ReactNode;
}

/** Header and footer stay put, the body scrolls when the dialog hits its max height. */
export function ScreenLayout({
  titleId,
  title,
  subtitle,
  media,
  meta,
  onBack,
  onClose,
  children,
  footer,
  status,
}: ScreenLayoutProps) {
  return (
    <div className="pk-screen">
      <header className="relative shrink-0">
        <div className="absolute -top-3 -right-3 -left-3 flex items-center justify-between">
          {onBack ? (
            <IconButton label="Back" onClick={onBack}>
              <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          ) : (
            <span />
          )}
          {onClose ? (
            <IconButton label="Close" onClick={onClose}>
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <div className="flex flex-col items-center px-2 pt-2 text-center">
          {media ? <div className="mb-4">{media}</div> : null}
          {/* Without media the title shares the first row with the corner buttons; the subtitle
              starts below them and can use the full width. */}
          <h2
            id={titleId}
            className={clsx(
              'text-[20px] leading-7 font-semibold tracking-[-0.01em] text-balance text-fg',
              !media && 'px-8',
            )}
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-[15px] leading-[22px] text-pretty text-fg-2">{subtitle}</p>
          ) : null}
          {meta ? <div className="mt-3">{meta}</div> : null}
        </div>
      </header>
      {children ? <div className="pk-screen-body">{children}</div> : null}
      <div aria-live="polite" className="shrink-0">
        {status}
      </div>
      {footer ? <div className="mt-6 shrink-0">{footer}</div> : null}
    </div>
  );
}

export function IconTile({
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
        'flex items-center justify-center',
        size === 64 ? 'size-16 rounded-[20px]' : 'size-12 rounded-2xl',
        tone === 'neutral' && 'bg-surface-2 text-fg',
        tone === 'accent' && 'bg-accent text-accent-fg',
        tone === 'danger' && 'bg-surface-2 text-danger',
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
