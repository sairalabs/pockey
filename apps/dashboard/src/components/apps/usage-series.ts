import type { UsagePoint } from '@pocketkey/types';
import type { ChartPoint } from '@/components/charts/usage-chart';
import { formatBucket, formatEth, formatInt } from '@/lib/format';

/** The counters a usage point carries, as the dashboard plots them. */
export type CountMetric = 'activeUsers' | 'walletsCreated' | 'txSigned' | 'sessionSigned';

export function countSeries(points: readonly UsagePoint[], metric: CountMetric): ChartPoint[] {
  return points.map((point) => ({
    key: point.date,
    label: formatBucket(point.date),
    value: point[metric],
    display: formatInt(point[metric]),
  }));
}

/** Sponsored gas in ETH. Wei is a decimal string, so it is summed as BigInt. */
export function gasSeries(points: readonly UsagePoint[]): ChartPoint[] {
  return points.map((point) => ({
    key: point.date,
    label: formatBucket(point.date),
    value: Number(point.gasSponsoredWei) / 1e18,
    display: `${formatEth(point.gasSponsoredWei, 6)} ETH`,
  }));
}

export function sumCounts(points: readonly UsagePoint[], metric: CountMetric): number {
  return points.reduce((total, point) => total + point[metric], 0);
}

export function sumWei(points: readonly UsagePoint[]): string {
  return points.reduce((total, point) => total + BigInt(point.gasSponsoredWei), 0n).toString();
}

export function sumLamports(points: readonly UsagePoint[]): string {
  return points.reduce((total, point) => total + BigInt(point.gasSponsoredLamports), 0n).toString();
}

export function numbers(points: readonly ChartPoint[]): number[] {
  return points.map((point) => point.value);
}
