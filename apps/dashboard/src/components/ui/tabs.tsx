'use client';

import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/*
  Underline tabs. No sliding indicator: better-ui asks for nothing beyond a
  150ms color transition on tabs. The hairline is a pseudo element on the
  active tab; the list bottom border is a divider, so it stays a border.
*/

export const Tabs = BaseTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn('relative flex gap-5 border-b border-border', className)}
      {...props}
    />
  );
}

export function Tab({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative flex h-10 select-none items-center gap-1.5 text-[13px] font-medium text-fg-2 outline-none',
        'transition-[color] duration-150 ease-out hover:text-fg data-active:text-fg',
        'after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent data-active:after:bg-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
}

export function TabPanel({ className, ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn('outline-none', className)} {...props} />;
}
