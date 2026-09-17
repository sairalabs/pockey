'use client';

import type { AdminUsage, UsageRange } from '@pocketkey/types';
import { useRef, useState } from 'react';
import { errorMessage, getUsage } from '@/lib/api';

export interface UsageState {
  range: UsageRange;
  setRange: (range: UsageRange) => void;
  usage: AdminUsage;
  /** True while a new range is loading: the previous render stays on screen. */
  loading: boolean;
  error: string | null;
}

/**
 * Range switch for the usage graphs. The first range is rendered on the server,
 * every other one is fetched through the proxy from the event handler, never
 * from an effect. dataviz: a refetch keeps the frame, so the charts hold their
 * previous render instead of flashing a skeleton.
 */
export function useUsage(appId: string, initial: AdminUsage): UsageState {
  const [range, setRange] = useState<UsageRange>(initial.range);
  const [usage, setUsage] = useState<AdminUsage>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the last range asked for wins, whatever order the answers come back in.
  const latest = useRef(0);

  const changeRange = (next: UsageRange) => {
    if (next === range) return;
    setRange(next);
    setLoading(true);
    setError(null);
    latest.current += 1;
    const ticket = latest.current;
    getUsage(appId, next)
      .then((data) => {
        if (latest.current === ticket) setUsage(data);
      })
      .catch((cause: unknown) => {
        if (latest.current === ticket) setError(errorMessage(cause, 'Could not load this range'));
      })
      .finally(() => {
        if (latest.current === ticket) setLoading(false);
      });
  };

  return { range, setRange: changeRange, usage, loading, error };
}

export const rangeOptions: readonly { value: UsageRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '12m', label: 'Last 12 months' },
];
