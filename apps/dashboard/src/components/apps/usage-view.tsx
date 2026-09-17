'use client';

import type { AdminApp, AdminUsage } from '@pocketkey/types';
import type { ReactNode } from 'react';
import { rangeOptions, useUsage } from '@/components/apps/use-usage';
import { countSeries, gasSeries, sumCounts, sumWei } from '@/components/apps/usage-series';
import { UsageChart, type ChartPoint } from '@/components/charts/usage-chart';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { Kpi } from '@/components/ui/kpi';
import { PillSelect } from '@/components/ui/pill-select';
import { Table, Td, Th } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatBucket, formatEth, formatInt, formatSol } from '@/lib/format';

const methodLabels: Record<string, string> = {
  email: 'Email',
  google: 'Google',
  apple: 'Apple',
  passkey: 'Passkey',
  wallet: 'Wallet',
};

function ChartCard({
  label,
  value,
  unit,
  hint,
  points,
  ariaLabel,
  formatTick,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  points: readonly ChartPoint[];
  ariaLabel: string;
  formatTick?: (value: number) => string;
}) {
  return (
    <Card accent className="flex flex-col">
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5 leading-none">
        <span className="text-2xl font-medium tracking-[-0.01em]">{value}</span>
        {unit ? <span className="text-[13px] text-fg-3">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-2 text-[12px] text-fg-3">{hint}</p> : null}
      <UsageChart
        className="mt-5"
        points={points}
        ariaLabel={ariaLabel}
        {...(formatTick ? { formatTick } : {})}
      />
    </Card>
  );
}

/** Proportional row for one login method. Not a chart: one measure, five names. */
function MethodRow({ label, users, max }: { label: string; users: number; max: number }) {
  const width = max === 0 ? 0 : Math.round((users / max) * 100);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-20 shrink-0 text-[13px] text-fg-2">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2">
        <span
          className="block h-full rounded-pill bg-accent transition-[width] duration-150 ease-out"
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="w-16 shrink-0 text-right text-[13px] font-medium num">
        {formatInt(users)}
      </span>
    </div>
  );
}

export interface UsageViewProps {
  app: AdminApp;
  usage: AdminUsage;
}

export function UsageView({ app, usage: initial }: UsageViewProps) {
  const { range, setRange, usage, loading, error } = useUsage(app.app.id, initial);
  const points = usage.points;
  const rangeLabel = rangeOptions.find((option) => option.value === range)?.label ?? range;
  const maxMethod = usage.loginMethods.reduce((max, entry) => Math.max(max, entry.users), 0);

  const sections: ReactNode = (
    <>
      <ChartCard
        label="Active wallets"
        value={formatInt(sumCounts(points, 'activeUsers'))}
        hint="Counted once per wallet per calendar month, on its first signature of that month."
        points={countSeries(points, 'activeUsers')}
        ariaLabel={`Active wallets, ${rangeLabel}`}
      />
      <ChartCard
        label="Transactions signed"
        value={formatInt(sumCounts(points, 'txSigned'))}
        points={countSeries(points, 'txSigned')}
        ariaLabel={`Transactions signed, ${rangeLabel}`}
      />
      <ChartCard
        label="Wallets created"
        value={formatInt(sumCounts(points, 'walletsCreated'))}
        points={countSeries(points, 'walletsCreated')}
        ariaLabel={`Wallets created, ${rangeLabel}`}
      />
      <ChartCard
        label="Gas sponsored"
        value={formatEth(sumWei(points))}
        unit="ETH"
        points={gasSeries(points)}
        ariaLabel={`Gas sponsored in ETH, ${rangeLabel}`}
        formatTick={(value) => value.toFixed(value < 1 ? 4 : 2)}
      />
    </>
  );

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
        value={formatInt(usage.month.activeUsers)}
        info="Distinct wallets that signed at least once this calendar month."
      />

      {error !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div
        className={cn(
          'grid gap-4 transition-[opacity] duration-150 ease-out',
          loading && 'opacity-60',
        )}
      >
        {sections}
      </div>

      <Card>
        <p className="text-sm font-medium">Login methods</p>
        <p className="mt-0.5 mb-3 text-[13px] text-fg-2">
          Distinct end users per identity, all time.
        </p>
        <div className="divide-y divide-border">
          {usage.loginMethods.map((entry) => (
            <MethodRow
              key={entry.method}
              label={methodLabels[entry.method] ?? entry.method}
              users={entry.users}
              max={maxMethod}
            />
          ))}
        </div>
      </Card>

      <Card flush>
        <Table>
          <thead>
            <tr>
              <Th>{range === '12m' ? 'Month' : 'Day'}</Th>
              <Th className="text-right">Active</Th>
              <Th className="text-right">Transactions</Th>
              <Th className="text-right">Created</Th>
              <Th className="text-right">Sessions</Th>
              <Th className="text-right">Gas (ETH)</Th>
              <Th className="text-right">Gas (SOL)</Th>
            </tr>
          </thead>
          <tbody>
            {points
              .slice()
              .reverse()
              .map((point) => (
                <tr key={point.date}>
                  <Td className="text-fg-2">{formatBucket(point.date)}</Td>
                  <Td className="text-right num">{formatInt(point.activeUsers)}</Td>
                  <Td className="text-right num">{formatInt(point.txSigned)}</Td>
                  <Td className="text-right num">{formatInt(point.walletsCreated)}</Td>
                  <Td className="text-right num">{formatInt(point.sessionSigned)}</Td>
                  <Td className="text-right num">{formatEth(point.gasSponsoredWei, 5)}</Td>
                  <Td className="text-right num">{formatSol(point.gasSponsoredLamports, 5)}</Td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
