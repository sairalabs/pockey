'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { Kpi } from '@/components/ui/kpi';
import { PillSelect } from '@/components/ui/pill-select';
import { Segmented } from '@/components/ui/segmented';
import { StatCard } from '@/components/ui/stat-card';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDay, formatEth, formatInt } from '@/lib/format';
import {
  seriesOf,
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

export function UsageView({ app }: { app: AppSummary }) {
  const [range, setRange] = useState<Range>('7d');
  const [platform, setPlatform] = useState<Platform>('web');
  const points = usage[range];
  const totals = sumMetrics(points, platform);

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Usage"
        description="Metered daily, billed monthly. Same numbers as your invoice."
        actions={
          <PillSelect
            aria-label="Time range"
            value={range}
            options={rangeOptions}
            onValueChange={setRange}
          />
        }
      />

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
          series={seriesOf(points, platform, 'gasSponsoredWei')}
        />
        <StatCard
          label="Sessions signed"
          value={formatInt(totals.sessionsSigned)}
          series={seriesOf(points, platform, 'sessionsSigned')}
        />
      </div>

      <Card flush>
        <Table>
          <thead>
            <tr>
              <Th>Day</Th>
              <Th className="text-right">Active wallets</Th>
              <Th className="text-right">Transactions</Th>
              <Th className="text-right">Gas (ETH)</Th>
              <Th className="text-right">Sessions</Th>
              <Th className="text-right">Wallets created</Th>
            </tr>
          </thead>
          <tbody>
            {points
              .slice()
              .reverse()
              .map((point) => {
                const m = point[platform];
                return (
                  <tr key={point.date}>
                    <Td className="text-fg-2">{formatDay(point.date)}</Td>
                    <Td className="text-right num">{formatInt(m.activeWallets)}</Td>
                    <Td className="text-right num">{formatInt(m.txSigned)}</Td>
                    <Td className="text-right num">{formatEth(m.gasSponsoredWei, 5)}</Td>
                    <Td className="text-right num">{formatInt(m.sessionsSigned)}</Td>
                    <Td className="text-right num">{formatInt(m.walletsCreated)}</Td>
                  </tr>
                );
              })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
