'use client';

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CardRow } from '@/components/ui/card';
import { Kpi } from '@/components/ui/kpi';
import { PillSelect } from '@/components/ui/pill-select';
import { Segmented } from '@/components/ui/segmented';
import { StatCard } from '@/components/ui/stat-card';
import { formatEth, formatInt, formatUsd } from '@/lib/format';
import {
  actions,
  entryPoints,
  seriesOf,
  sponsoring,
  sumMetrics,
  usage,
  type AppSummary,
  type Platform,
  type Range,
} from '@/lib/mock-data';

const rangeOptions = [
  { value: '7d', label: 'Last week' },
  { value: '30d', label: 'Last month' },
] as const;

const platformOptions = [
  { value: 'web', label: 'Web' },
  { value: 'reactNative', label: 'React Native' },
] as const;

export function HomeView({ app }: { app: AppSummary }) {
  const [range, setRange] = useState<Range>('7d');
  const [platform, setPlatform] = useState<Platform>('web');

  const points = usage[range];
  const totals = sumMetrics(points, platform);
  // Balance series: today's balance minus what each day sponsored, walking back.
  const gasSeries = seriesOf(points, platform, 'gasSponsoredWei');
  const balanceSeries = gasSeries
    .slice()
    .reverse()
    .reduce<number[]>((acc, gas) => {
      const previous = acc[acc.length - 1] ?? sponsoring.balanceUsd;
      acc.push(previous + gas / 1e6 / 1000);
      return acc;
    }, [])
    .reverse();

  return (
    <div className="stagger flex flex-col gap-6">
      <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em]">
        Welcome, {app.app.name}
      </h1>

      <div className="flex items-center justify-between gap-3">
        <PillSelect
          aria-label="Time range"
          value={range}
          options={rangeOptions}
          onValueChange={setRange}
        />
        <Button size="sm" iconEnd={<ChevronRight strokeWidth={2} />}>
          App rankings
        </Button>
      </div>

      <Kpi
        label="Monthly active wallets"
        value={formatInt(app.mawThisMonth)}
        info="Distinct wallets that signed at least once this calendar month."
      />

      <Segmented
        aria-label="Platform"
        value={platform}
        options={platformOptions}
        onValueChange={setPlatform}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Active wallets"
          value={formatInt(totals.activeWallets)}
          series={seriesOf(points, platform, 'activeWallets')}
        />
        <StatCard
          label="Transactions signed"
          value={formatInt(totals.txSigned)}
          series={seriesOf(points, platform, 'txSigned')}
        />
        <StatCard
          label="Gas sponsored"
          value={formatEth(totals.gasSponsoredWei)}
          unit="ETH"
          series={gasSeries}
        />
        <StatCard
          label="Sponsor balance"
          value={formatUsd(sponsoring.balanceUsd)}
          unit="USD"
          series={balanceSeries}
        />
        <StatCard
          label="Sessions signed"
          value={formatInt(totals.sessionsSigned)}
          series={seriesOf(points, platform, 'sessionsSigned')}
        />
        <StatCard
          label="Wallets created"
          value={formatInt(totals.walletsCreated)}
          series={seriesOf(points, platform, 'walletsCreated')}
        />
        <StatCard
          label="Entry points"
          value={formatInt(entryPoints[platform].reduce((sum, e) => sum + e.count, 0))}
        >
          <div className="flex flex-col gap-1.5">
            {entryPoints[platform].map((entry) => (
              <CardRow key={entry.method}>
                <span className="text-fg-2">{entry.label}</span>
                <span className="font-medium num">{formatInt(entry.count)}</span>
              </CardRow>
            ))}
          </div>
        </StatCard>
        <StatCard
          label="Actions"
          value={formatInt(actions[platform].reduce((sum, a) => sum + a.count, 0))}
        >
          <div className="flex flex-col gap-1.5">
            {actions[platform].map((action) => (
              <CardRow key={action.label}>
                <span className="text-fg-2">{action.label}</span>
                <span className="font-medium num">{formatInt(action.count)}</span>
              </CardRow>
            ))}
          </div>
        </StatCard>
      </div>
    </div>
  );
}
