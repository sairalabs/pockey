'use client';

import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { X } from './icons';
import { useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';
import { isKeyboardEvent } from '@/lib/motion';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name. Rendered as the header unless `titleHidden`. */
  title: string;
  titleHidden?: boolean;
  description?: string;
  /** `sm` is a 480px form dialog with padding, `settings` is the large split dialog. */
  size?: 'sm' | 'settings';
  children: ReactNode;
  className?: string;
}

/**
 * Centered modal (transform-origin stays center, it is not anchored), radius
 * 24px, backdrop oklch(0 0 0 / 0.6) + blur(4px), scale 0.97 + opacity, 200ms
 * enter and 150ms exit.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  titleHidden = false,
  description,
  size = 'sm',
  children,
  className,
}: DialogProps) {
  const [noMotion, setNoMotion] = useState(false);

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) setNoMotion(isKeyboardEvent(details.event));
        onOpenChange(next);
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          data-no-motion={noMotion ? '' : undefined}
          className="dialog-backdrop fixed inset-0 z-50"
        />
        <BaseDialog.Popup
          data-no-motion={noMotion ? '' : undefined}
          className={cn(
            'dialog-popup fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'rounded-dialog bg-surface text-fg outline-none',
            size === 'sm' && 'w-[min(480px,calc(100vw-32px))] p-6',
            size === 'settings' &&
              'flex h-[min(82vh,640px)] w-[min(880px,calc(100vw-48px))] overflow-hidden',
            className,
          )}
        >
          {titleHidden ? (
            <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>
          ) : (
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <BaseDialog.Title className="text-lg font-semibold leading-tight">
                  {title}
                </BaseDialog.Title>
                {description ? (
                  <BaseDialog.Description className="mt-1 text-[13px] text-fg-2">
                    {description}
                  </BaseDialog.Description>
                ) : null}
              </div>
              <BaseDialog.Close
                render={<IconButton aria-label="Close" size="sm" className="-me-1.5 -mt-1" />}
              >
                <X />
              </BaseDialog.Close>
            </div>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Close button for dialogs that render their own header (settings). */
export function DialogClose({ className }: { className?: string }) {
  return (
    <BaseDialog.Close render={<IconButton aria-label="Close" size="sm" className={className} />}>
      <X />
    </BaseDialog.Close>
  );
}
