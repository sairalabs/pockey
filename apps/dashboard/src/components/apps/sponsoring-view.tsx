'use client';

import type { AdminApp, SponsorBalance } from '@pockey/types';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { TopUpDialog } from '@/components/apps/top-up-dialog';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { SwitchRow } from '@/components/ui/switch';
import { errorMessage, updateApp } from '@/lib/api';
import { formatCents, formatEth, formatInt, formatSol } from '@/lib/format';

export interface SponsoringViewProps {
  app: AdminApp;
  balance: SponsorBalance;
}

export function SponsoringView({ app, balance }: SponsoringViewProps) {
  const id = useId();
  const router = useRouter();
  const sponsoring = app.app.config.gasSponsoring;
  const [evm, setEvm] = useState(sponsoring.evm);
  const [solana, setSolana] = useState(sponsoring.solana);
  const [cap, setCap] = useState(sponsoring.solanaDailyCapLamports);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState(false);

  const capValid = /^\d+$/.test(cap.trim());
  const spentToday = Number(balance.solanaSpentTodayLamports);
  const capToday = Number(balance.solanaDailyCapLamports);

  const save = async () => {
    if (!capValid) {
      setError('The Solana daily cap is a whole number of lamports.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateApp(app.app.id, {
        config: { gasSponsoring: { evm, solana, solanaDailyCapLamports: cap.trim() } },
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 1500);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save the sponsoring settings'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Sponsoring"
        description="Pay gas for your users from a prepaid balance."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setToppingUp(true);
            }}
          >
            Top up
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card accent>
          <p className="text-[13px] text-fg-2">Balance</p>
          <p className="mt-1.5 text-2xl font-medium leading-none">
            {formatCents(balance.balanceCents)}
          </p>
          <p className="mt-3 text-[13px] text-fg-3">
            Real cost plus 15 percent. Sponsoring stops at zero, users keep signing.
          </p>
        </Card>
        <Card accent>
          <p className="text-[13px] text-fg-2">Sponsored this month</p>
          <p className="mt-1.5 flex items-baseline gap-1.5 leading-none">
            <span className="text-2xl font-medium num">{formatEth(app.usage.gasSponsoredWei)}</span>
            <span className="text-[13px] text-fg-3">ETH</span>
          </p>
          <p className="mt-3 text-[13px] text-fg-3 num">
            {formatSol(app.usage.gasSponsoredLamports)} SOL on Solana
          </p>
        </Card>
      </div>

      <Card>
        <p className="text-sm font-medium">Chains</p>
        <div className="mt-1 divide-y divide-border">
          <SwitchRow
            title="EVM"
            description="ERC-4337 paymaster on the enabled EVM chains."
            checked={evm}
            onCheckedChange={setEvm}
          />
          <SwitchRow
            title="Solana"
            description="Fee payer on the enabled clusters, capped in lamports."
            checked={solana}
            onCheckedChange={setSolana}
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium">Solana daily cap</p>
        <p className="mt-0.5 text-[13px] text-fg-2">
          Lamports the fee payer may spend per UTC day. Zero means no daily cap, the prepaid balance
          stays the limit.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Cap (lamports per day)" htmlFor={`${id}-cap`}>
            <Input
              id={`${id}-cap`}
              inputMode="numeric"
              value={cap}
              className="num"
              aria-invalid={!capValid || undefined}
              onChange={(event) => {
                setCap(event.target.value);
                setError(null);
              }}
            />
          </Field>
          <div className="flex flex-col justify-end">
            <p className="text-[13px] text-fg-2 num">
              Spent today {formatInt(spentToday)} lamports
              {capToday > 0 ? ` of ${formatInt(capToday)}` : ', no cap set'}
            </p>
            <span className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-2">
              <span
                className="block h-full rounded-pill bg-accent"
                style={{
                  width:
                    capToday > 0
                      ? `${Math.min(100, Math.round((spentToday / capToday) * 100))}%`
                      : '0%',
                }}
              />
            </span>
          </div>
        </div>
        {error !== null ? (
          <p role="alert" className="mt-4 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-3">
          <span aria-live="polite" className="text-[13px] text-fg-2">
            {saved ? 'Saved' : ''}
          </span>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              void save();
            }}
          >
            {pending ? 'Saving' : 'Save sponsoring'}
          </Button>
        </div>
      </Card>

      <TopUpDialog appId={app.app.id} open={toppingUp} onOpenChange={setToppingUp} />
    </div>
  );
}
