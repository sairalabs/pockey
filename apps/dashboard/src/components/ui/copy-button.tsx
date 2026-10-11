'use client';

import { Check, Copy } from './icons';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/cn';

export interface CopyButtonProps {
  value: string;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/*
  Contextual icon swap per better-ui icon-transitions (CSS recipe): both icons
  stay in the DOM, one absolutely positioned, cross-faded with scale 0.25 to 1,
  opacity 0 to 1, blur 4px to 0, cubic-bezier(0.2, 0, 0, 1).
*/
const iconBase =
  'absolute inset-0 flex items-center justify-center transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]';
const hidden = 'opacity-0 scale-[0.25] blur-[4px]';
const shown = 'opacity-100 scale-100 blur-0';

export function CopyButton({ value, label = 'Copy', size = 'sm', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <IconButton
      aria-label={copied ? 'Copied' : label}
      size={size}
      className={cn('relative', className)}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      <span aria-hidden="true" className={cn(iconBase, copied ? hidden : shown)}>
        <Copy />
      </span>
      <span aria-hidden="true" className={cn(iconBase, copied ? shown : hidden)}>
        <Check />
      </span>
    </IconButton>
  );
}
