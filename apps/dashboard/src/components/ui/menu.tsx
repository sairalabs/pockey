'use client';

import { Menu as BaseMenu } from '@base-ui-components/react/menu';
import { useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { isKeyboardEvent } from '@/lib/motion';

export interface MenuProps {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
}

/**
 * Popup radius 12px with 4px padding, so items are 8px (concentric).
 * Same motion contract as Popover.
 */
export function Menu({
  trigger,
  children,
  side = 'bottom',
  align = 'end',
  sideOffset = 8,
  className,
}: MenuProps) {
  const [noMotion, setNoMotion] = useState(false);

  return (
    <BaseMenu.Root
      onOpenChange={(open, details) => {
        if (open) setNoMotion(isKeyboardEvent(details.event));
      }}
    >
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-50 outline-none"
        >
          <BaseMenu.Popup
            data-no-motion={noMotion ? '' : undefined}
            className={cn('popup min-w-52 rounded-[12px] bg-surface p-1 outline-none', className)}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface MenuItemProps extends ComponentProps<typeof BaseMenu.Item> {
  /** 16px lucide icon, stroke 1.5 (regular text). */
  icon?: ReactNode;
  tone?: 'default' | 'danger';
}

export function MenuItem({ icon, tone = 'default', className, children, ...props }: MenuItemProps) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none',
        'transition-[background-color,color] duration-100 ease-out',
        'data-highlighted:bg-surface-2 data-disabled:opacity-50',
        tone === 'danger' ? 'text-danger' : 'text-fg-2 data-highlighted:text-fg',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </BaseMenu.Item>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-3">
      {children}
    </div>
  );
}
