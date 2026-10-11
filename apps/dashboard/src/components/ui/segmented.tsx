'use client';

import { Toggle } from '@base-ui-components/react/toggle';
import { ToggleGroup } from '@base-ui-components/react/toggle-group';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  'aria-label': string;
  className?: string;
}

/**
 * `Base App | Other` pill segmented control. Selected segment is lighter.
 * Only a 150ms background-color transition, no sliding indicator, no stagger.
 */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(next) => {
        const first: unknown = next[0];
        const match = options.find((option) => option.value === first);
        if (match) onValueChange(match.value);
      }}
      className={cn('inline-flex items-center gap-0.5 rounded-control bg-surface-2 p-1', className)}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            'h-8 select-none rounded-[8px] px-3.5 text-[13px] font-medium text-fg-2',
            'transition-[background-color,color] duration-150 ease-out',
            'hover:text-fg data-pressed:bg-surface-3 data-pressed:text-fg',
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
