'use client';

import type { BillingSummary } from '@pocketkey/types';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kpi } from '@/components/ui/kpi';
import { errorMessage, getBillingPortal } from '@/lib/api';
import { formatCents, formatInt } from '@/lib/format';

export function BillingView({ billing }: { billing: BillingSummary }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = Math.min(100, Math.round((billing.activeWallets / billing.includedWallets) * 100));
  const billable = Math.max(0, billing.activeWallets - billing.includedWallets);

  const openPortal = async () => {
    setPending(true);
    setError(null);
    try {
      const portal = await getBillingPortal(`${window.location.origin}/billing`);
      window.location.assign(portal.url);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not open the billing portal'));
      setPending(false);
    }
  };

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Billing"
        badge={
          <Badge tone={billing.plan === 'free' ? 'neutral' : 'accent'}>
            {billing.plan === 'free' ? 'Free' : 'Pay as you go'}
          </Badge>
        }
        description="Usage based, no flat plan. You pay for what your users do."
        actions={
          <Button
            iconEnd={<ExternalLink strokeWidth={2} />}
            disabled={pending || !billing.portalAvailable}
            onClick={() => {
              void openPortal();
            }}
          >
            {pending ? 'Opening' : 'Manage billing'}
          </Button>
        }
      />

      {billing.portalAvailable ? null : (
        <p className="text-[13px] text-fg-2">
          The billing portal opens once you have a payment customer, which is created with your
          first paid invoice or your first gas top up.
        </p>
      )}
      {error !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <Kpi
        label="Monthly active wallets, every app"
        value={formatInt(billing.activeWallets)}
        info="Distinct wallets that signed at least once this calendar month, across all your apps."
      />

      <Card>
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm font-medium">Included in the free tier</p>
          <p className="text-[13px] text-fg-2 num">
            {formatInt(Math.min(billing.activeWallets, billing.includedWallets))} of{' '}
            {formatInt(billing.includedWallets)}
          </p>
        </div>
        <span className="mt-3 block h-2 overflow-hidden rounded-pill bg-surface-2">
          <span
            className="block h-full rounded-pill bg-accent transition-[width] duration-150 ease-out"
            style={{ width: `${used}%` }}
          />
        </span>
        <p className="mt-3 text-[13px] text-fg-3 num">
          {billable === 0
            ? `Nothing billable yet. Past ${formatInt(billing.includedWallets)} active wallets, each one costs ${formatCents(billing.unitPriceCents)}.`
            : `${formatInt(billable)} billable active wallets at ${formatCents(billing.unitPriceCents)} each.`}
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card accent>
          <p className="text-[13px] text-fg-2">Estimated this month</p>
          <p className="mt-1.5 text-2xl font-medium leading-none">
            {formatCents(billing.estimatedCents)}
          </p>
          <p className="mt-3 text-[13px] text-fg-3">
            What the current month would cost if it ended now.
          </p>
        </Card>
        <Card accent>
          <p className="text-[13px] text-fg-2">Prepaid gas balance</p>
          <p className="mt-1.5 text-2xl font-medium leading-none">
            {formatCents(billing.sponsorBalanceCents)}
          </p>
          <p className="mt-3 text-[13px] text-fg-3">
            Sum of the sponsoring balances of every app. Top up from an app.
          </p>
        </Card>
      </div>
    </div>
  );
}
