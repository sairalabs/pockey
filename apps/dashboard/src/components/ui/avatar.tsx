import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

export interface AvatarProps {
  /** Any stable string (email, app id). Drives the gradient. */
  seed: string;
  /** Pixel size. */
  size?: number;
  shape?: 'circle' | 'square';
  /** Letter shown over the gradient. */
  initial?: string;
  className?: string;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Gradient placeholder avatar with the better-ui 1px white outline. */
export function Avatar({ seed, size = 32, shape = 'circle', initial, className }: AvatarProps) {
  const h = hash(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 48) % 360;
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.45),
    background: `linear-gradient(135deg, oklch(0.72 0.16 ${hue1}), oklch(0.48 0.19 ${hue2}))`,
  };
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center font-semibold text-white',
        'outline-1 -outline-offset-1 outline-white/10',
        shape === 'circle' ? 'rounded-full' : 'rounded-[6px]',
        className,
      )}
    >
      {initial}
    </span>
  );
}
