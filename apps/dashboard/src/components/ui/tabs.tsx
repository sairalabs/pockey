'use client';

import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/*
  Underline tabs. No sliding indicator: better-ui asks for nothing beyond a
  150ms color transition on tabs. Flat brand: only the active tab carries its
  accent bar, the full width rule under the list is gone.
*/

export const Tabs = BaseTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return <BaseTabs.List className={cn('relative flex gap-5', className)} {...props} />;
}

export function Tab({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative flex h-10 select-none items-center gap-1.5 text-[13px] font-medium text-fg-2 outline-none',
        'transition-[color] duration-150 ease-out hover:text-fg data-active:text-fg',
        'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-active:after:bg-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white',
        className,
      )}
      {...props}
    />
  );
}

export function TabPanel({ className, ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn('outline-none', className)} {...props} />;
}
