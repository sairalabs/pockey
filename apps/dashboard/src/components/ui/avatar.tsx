'use client';

import { Hashvatar } from 'hashvatar/react';
import { cn } from '@/lib/cn';

export interface AvatarProps {
  /** Any stable string (email, app id). Same string always draws the same avatar. */
  seed: string;
  /** Pixel size. */
  size?: number;
  className?: string;
}

/** Deterministic avatar, drawn by hashvatar in dither. Always a circle, never a letter. */
export function Avatar({ seed, size = 32, className }: AvatarProps) {
  return (
    <Hashvatar
      hash={seed}
      size={size}
      mode="dither"
      className={cn('shrink-0 select-none', className)}
      style={{ borderRadius: '50%', display: 'block' }}
    />
  );
}
