'use client';

import { Select } from '@base-ui-components/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { isKeyboardEvent } from '@/lib/motion';

export interface PillSelectOption<T extends string> {
  value: T;
  label: string;
}

export interface PillSelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly PillSelectOption<T>[];
  'aria-label': string;
  size?: 'sm' | 'md';
  className?: string;
}

/** `Last week` style pill select built on Base UI Select. */
export function PillSelect<T extends string>({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  size = 'sm',
  className,
}: PillSelectProps<T>) {
  const [noMotion, setNoMotion] = useState(false);

  return (
    <Select.Root<T>
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      onOpenChange={(open, details) => {
        if (open) setNoMotion(isKeyboardEvent(details.event));
      }}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={cn(
          'inline-flex select-none items-center gap-1.5 rounded-pill bg-surface-2 font-medium text-fg shadow-border',
          'transition-[transform,background-color,box-shadow] duration-150 ease-out',
          'hover:bg-surface-3 hover:shadow-border-hover active:scale-[0.96] data-popup-open:bg-surface-3',
          size === 'sm' ? 'h-8 ps-3 pe-2.5 text-[13px]' : 'h-10 ps-4 pe-3 text-sm',
          className,
        )}
      >
        <Select.Value />
        <Select.Icon className="flex text-fg-2">
          <ChevronDown className="size-4" strokeWidth={2} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
          className="z-50 outline-none"
        >
          <Select.Popup
            data-no-motion={noMotion ? '' : undefined}
            className="popup min-w-(--anchor-width) rounded-[12px] bg-surface p-1 shadow-border outline-none"
          >
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className={cn(
                    'flex h-8 cursor-default select-none items-center gap-2 rounded-lg ps-2.5 pe-2 text-[13px] text-fg-2 outline-none',
                    'transition-[background-color,color] duration-100 ease-out',
                    'data-highlighted:bg-surface-2 data-highlighted:text-fg data-selected:text-fg',
                  )}
                >
                  <Select.ItemText className="flex-1">{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="flex">
                    <Check className="size-3.5" strokeWidth={2} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
