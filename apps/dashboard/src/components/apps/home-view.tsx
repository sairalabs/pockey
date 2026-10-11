'use client';

import type { AdminApp, AdminUsage, SponsorBalance } from '@pockey/types';
import { ChevronRight } from '../ui/icons';
import { rangeOptions, useUsage } from '@/components/apps/use-usage';
import { countSeries, gasSeries, numbers, sumCounts, sumWei } from '@/components/apps/usage-series';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardRow } from '@/components/ui/card';
import { Kpi } from '@/components/ui/kpi';
import { PillSelect } from '@/components/ui/pill-select';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/cn';
import { formatCents, formatEth, formatInt } from '@/lib/format';

const methodLabels: Record<string, string> = {
  email: 'Email',
  google: 'Google',
  apple: 'Apple',
  passkey: 'Passkey',
  wallet: 'Wallet',
};

export interface HomeViewProps {
  app: AdminApp;
  usage: AdminUsage;
  sponsor: SponsorBalance;
}

export function HomeView({ app, usage: initial, sponsor }: HomeViewProps) {
  const { range, setRange, usage, loading, error } = useUsage(app.app.id, initial);
  const points = usage.points;

  const activeWallets = countSeries(points, 'activeUsers');
  const txSigned = countSeries(points, 'txSigned');
  const walletsCreated = countSeries(points, 'walletsCreated');
  const sessionsSigned = countSeries(points, 'sessionSigned');
  const gas = gasSeries(points);
  const loginTotal = usage.loginMethods.reduce((total, entry) => total + entry.users, 0);

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
        <ButtonLink size="sm" href={`/apps/${app.app.id}/usage`} iconEnd={<ChevronRight />}>
          Usage details
        </ButtonLink>
      </div>

      {app.endUserCount === 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Nobody has signed in yet</p>
            <p className="mt-0.5 text-[13px] text-fg-2">
              Pass the public app id to the SDK provider, and these numbers start filling in.
            </p>
          </div>
          <ButtonLink size="sm" href={`/apps/${app.app.id}/keys`}>
            Get the app id
          </ButtonLink>
        </Card>
      ) : null}

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
          'grid gap-4 transition-[opacity] duration-150 ease-out sm:grid-cols-2',
          loading && 'opacity-60',
        )}
      >
        <StatCard
          label="Active wallets"
          value={formatInt(sumCounts(points, 'activeUsers'))}
          series={numbers(activeWallets)}
        />
        <StatCard
          label="Transactions signed"
          value={formatInt(sumCounts(points, 'txSigned'))}
          series={numbers(txSigned)}
        />
        <StatCard
          label="Wallets created"
          value={formatInt(sumCounts(points, 'walletsCreated'))}
          series={numbers(walletsCreated)}
        />
        <StatCard
          label="Gas sponsored"
          value={formatEth(sumWei(points))}
          unit="ETH"
          series={numbers(gas)}
        />
        <StatCard
          label="Sessions signed"
          value={formatInt(sumCounts(points, 'sessionSigned'))}
          series={numbers(sessionsSigned)}
        />
        <StatCard label="Sponsor balance" value={formatCents(sponsor.balanceCents)} unit="USD">
          <div className="flex flex-col gap-1.5">
            <CardRow>
              <span className="text-fg-2">End users</span>
              <span className="font-medium num">{formatInt(app.endUserCount)}</span>
            </CardRow>
            <CardRow>
              <span className="text-fg-2">Active API keys</span>
              <span className="font-medium num">{formatInt(app.apiKeyCount)}</span>
            </CardRow>
          </div>
        </StatCard>
        <StatCard label="Login methods" value={formatInt(loginTotal)} className="sm:col-span-2">
          <div className="flex flex-col gap-1.5">
            {usage.loginMethods.map((entry) => (
              <CardRow key={entry.method}>
                <span className="text-fg-2">{methodLabels[entry.method] ?? entry.method}</span>
                <span className="font-medium num">{formatInt(entry.users)}</span>
              </CardRow>
            ))}
          </div>
        </StatCard>
      </div>
    </div>
  );
}
