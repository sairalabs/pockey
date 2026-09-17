'use client';

import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { formatInt } from '@/lib/format';

/**
 * One column chart, one series, inline SVG, no chart dependency.
 *
 * dataviz skill: columns for a measure over discrete time buckets, marks capped
 * at 24 units with a 4 unit rounded cap and a 2 unit gap, one recessive hairline
 * for the rounded maximum, axis and value text in HTML so it keeps the site
 * typography and never inherits the series color. The hover layer is part of the
 * chart: a pointer or the arrow keys move a readout that names the bucket and
 * its value, and the table under the charts keeps every value reachable without
 * hovering at all.
 */

export interface ChartPoint {
  /** Bucket key from the API, `YYYY-MM-DD` or `YYYY-MM`. */
  key: string;
  /** Human label of the bucket. */
  label: string;
  /** Numeric value, used for the scale. */
  value: number;
  /** Formatted value, used in the readout. */
  display: string;
}

export interface UsageChartProps {
  points: readonly ChartPoint[];
  /** Accessible name of the plot, for example `Transactions signed, last 30 days`. */
  ariaLabel: string;
  /** Formats the maximum tick. Defaults to a thousands separated integer. */
  formatTick?: (value: number) => string;
  className?: string;
}

const WIDTH = 560;
const HEIGHT = 140;
/** Head room so the tallest column never touches the maximum hairline. */
const TOP = 10;
// Viewbox units. A card renders about 1.2 pixels per unit, so 20 keeps the mark
// at or under the 24px cap the dataviz skill asks for.
const MAX_BAR = 20;
const GAP = 2;
const CAP = 4;

/** Round a maximum up to 1, 2 or 5 times a power of ten, so the tick is clean. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) {
    const candidate = step * magnitude;
    if (value <= candidate) return candidate;
  }
  return 10 * magnitude;
}

function columnPath(x: number, width: number, height: number): string {
  const top = HEIGHT - height;
  const radius = Math.min(CAP, width / 2, height);
  return [
    `M${x} ${HEIGHT}`,
    `L${x} ${top + radius}`,
    `Q${x} ${top} ${x + radius} ${top}`,
    `L${x + width - radius} ${top}`,
    `Q${x + width} ${top} ${x + width} ${top + radius}`,
    `L${x + width} ${HEIGHT}`,
    'Z',
  ].join(' ');
}

export function UsageChart({
  points,
  ariaLabel,
  formatTick = formatInt,
  className,
}: UsageChartProps) {
  const [active, setActive] = useState<number | null>(null);

  const count = Math.max(points.length, 1);
  const band = WIDTH / count;
  const barWidth = Math.max(2, Math.min(MAX_BAR, band - GAP));
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);
  const top = niceMax(peak);
  const scale = (value: number) => (value <= 0 ? 0 : (value / top) * (HEIGHT - TOP));

  const current = active === null ? null : (points[active] ?? null);
  const first = points[0];
  const last = points[points.length - 1];

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    setActive((index) => {
      const next = (index ?? (step > 0 ? -1 : points.length)) + step;
      return Math.max(0, Math.min(points.length - 1, next));
    });
  };

  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto w-full outline-offset-4"
          role="img"
          aria-label={`${ariaLabel}. Peak ${formatTick(peak)}.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setActive(null);
          }}
          onPointerLeave={() => {
            setActive(null);
          }}
        >
          {/* Recessive hairlines: the rounded maximum and the baseline. */}
          <line x1="0" y1={TOP} x2={WIDTH} y2={TOP} stroke="var(--border)" strokeWidth="1" />
          <line
            x1="0"
            y1={HEIGHT - 0.5}
            x2={WIDTH}
            y2={HEIGHT - 0.5}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
          {points.map((point, index) => {
            const height = scale(point.value);
            const x = band * index + (band - barWidth) / 2;
            return (
              <g key={point.key}>
                {height > 0 ? (
                  <path
                    d={columnPath(x, barWidth, height)}
                    fill="var(--accent)"
                    opacity={active === null || active === index ? 1 : 0.45}
                    className="transition-[opacity] duration-150 ease-out"
                  />
                ) : null}
                {/* Hit target: the whole band, never only the painted pixels. */}
                <rect
                  x={band * index}
                  y={0}
                  width={band}
                  height={HEIGHT}
                  fill="transparent"
                  onPointerEnter={() => {
                    setActive(index);
                  }}
                />
              </g>
            );
          })}
        </svg>

        <span className="pointer-events-none absolute right-0 top-0 -translate-y-1/2 bg-surface px-1 text-[11px] text-fg-3 num">
          {formatTick(top)}
        </span>

        {current ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute -top-1 left-0 right-0 flex justify-center"
          >
            <span className="flex items-baseline gap-2 rounded-[8px] bg-surface-3 px-2.5 py-1 shadow-border">
              <span className="text-[13px] font-medium num">{current.display}</span>
              <span className="text-[12px] text-fg-2">{current.label}</span>
            </span>
          </div>
        ) : null}
      </div>

      <figcaption className="flex items-center justify-between text-[11px] text-fg-3 num">
        <span>{first?.label ?? ''}</span>
        <span>{points.length > 1 ? (last?.label ?? '') : ''}</span>
      </figcaption>
    </figure>
  );
}
