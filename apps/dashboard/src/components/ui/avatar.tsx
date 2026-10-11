'use client';

import { Hashvatar } from 'hashvatar/react';
import { cn } from '@/lib/cn';

export interface AvatarProps {
  /** Any stable string (email, app id). Same string always draws the same avatar. */
  seed: string;
  /** Pixel size. */
  size?: number;
  shape?: 'circle' | 'square';
  /** Letter shown over the avatar. */
  initial?: string;
  className?: string;
}

/** Deterministic avatar, drawn by hashvatar. Flat: a fill, no outline. */
export function Avatar({ seed, size = 32, shape = 'circle', initial, className }: AvatarProps) {
  const radius = shape === 'circle' ? '50%' : '6px';
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className={cn('relative inline-flex shrink-0 select-none', className)}
    >
      <Hashvatar hash={seed} size={size} style={{ borderRadius: radius, display: 'block' }} />
      {initial ? (
        <span
          className="absolute inset-0 flex items-center justify-center font-semibold text-white"
          style={{ textShadow: '0 1px 3px oklch(0 0 0 / 0.45)' }}
        >
          {initial}
        </span>
      ) : null}
    </span>
  );
}
