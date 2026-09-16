import { cn } from '@/lib/cn';

export interface SparklineProps {
  series: readonly number[];
  className?: string;
}

/**
 * Tiny inline SVG line, no chart library. Muted stroke, non scaling so the
 * line stays 1.5px whatever the box size.
 */
export function Sparkline({ series, className }: SparklineProps) {
  const width = 100;
  const height = 32;
  const pad = 2;
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const span = max - min || 1;
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;
  const points = series
    .map((value, index) => {
      const x = pad + index * step;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('block h-12 w-full text-fg-3', className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
