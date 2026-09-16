'use client';

import { Switch as BaseSwitch } from '@base-ui-components/react/switch';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type SwitchProps = ComponentProps<typeof BaseSwitch.Root>;

/** 44x24 pill, 20px knob, white when on. Track and knob transition 150ms. */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-default items-center rounded-pill bg-surface-3 p-0.5',
        'shadow-border transition-[background-color] duration-150 ease-out',
        'data-checked:bg-[oklch(1_0_0/0.28)] data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block size-5 rounded-full bg-fg-3',
          'transition-[translate,background-color] duration-150 ease-out',
          'data-checked:translate-x-5 data-checked:bg-white',
        )}
      />
    </BaseSwitch.Root>
  );
}

export interface SwitchRowProps {
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Optional leading 16px icon. */
  icon?: ReactNode;
  disabled?: boolean;
}

/** Settings row: bold title + muted description on the left, switch on the right. */
export function SwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  icon,
  disabled = false,
}: SwitchRowProps) {
  return (
    <label className="flex items-center justify-between gap-6 py-3.5">
      <span className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-2 [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">{title}</span>
          {description ? (
            <span className="mt-0.5 block text-[13px] text-fg-2">{description}</span>
          ) : null}
        </span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={(next) => {
          onCheckedChange(next);
        }}
        disabled={disabled}
      />
    </label>
  );
}
