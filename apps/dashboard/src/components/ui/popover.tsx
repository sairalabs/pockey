'use client';

import { Popover as BasePopover } from '@base-ui-components/react/popover';
import { useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { isKeyboardEvent } from '@/lib/motion';

export interface PopoverProps {
  /** Element used as the trigger (an IconButton or Button). */
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
}

/**
 * Origin-aware popover: scales from `var(--transform-origin)` 0.97 to 1,
 * 150ms enter, 120ms exit, no motion when opened from the keyboard.
 */
export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'end',
  sideOffset = 8,
  className,
}: PopoverProps) {
  const [noMotion, setNoMotion] = useState(false);

  return (
    <BasePopover.Root
      onOpenChange={(open, details) => {
        if (open) setNoMotion(isKeyboardEvent(details.event));
      }}
    >
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-50 outline-none"
        >
          <BasePopover.Popup
            data-no-motion={noMotion ? '' : undefined}
            className={cn('popup rounded-card bg-surface shadow-border outline-none', className)}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
