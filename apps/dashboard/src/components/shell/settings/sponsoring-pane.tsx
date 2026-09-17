'use client';

import type { AdminApp, SponsorBalance } from '@pocketkey/types';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { TopUpDialog } from '@/components/apps/top-up-dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { SwitchRow } from '@/components/ui/switch';
import { errorMessage, getSponsorBalance, updateApp } from '@/lib/api';
import { formatCents, formatEth, formatInt, formatSol } from '@/lib/format';
import { KeyValue, Pane, PaneSection, SavedHint } from './pane';

export function SponsoringPane({ app }: { app: AdminApp }) {
  const id = useId();
  const router = useRouter();
  const sponsoring = app.app.config.gasSponsoring;
  const [balance, setBalance] = useState<SponsorBalance | null>(null);
  const [cap, setCap] = useState(sponsoring.solanaDailyCapLamports);
  const [evm, setEvm] = useState(sponsoring.evm);
  const [solana, setSolana] = useState(sponsoring.solana);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSponsorBalance(app.app.id)
      .then((next) => {
        if (!cancelled) setBalance(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [app.app.id]);

  const save = async () => {
    if (!/^\d+$/.test(cap.trim())) {
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
    <Pane
      title="Sponsoring"
      actions={
        <>
          <SavedHint visible={saved} />
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => {
              void save();
            }}
          >
            {pending ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      {error !== null ? (
        <p
          role="alert"
          className="mb-4 rounded-[10px] bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="divide-y divide-border">
        <PaneSection title="Balance" description="Prepaid balance used to pay gas for your users.">
          <div className="flex items-center justify-between gap-4 rounded-[12px] bg-surface-2 px-4 py-3.5 shadow-border">
            <div>
              <p className="text-2xl font-medium leading-none">
                {balance ? formatCents(balance.balanceCents) : '...'}
              </p>
              <p className="mt-1.5 text-[13px] text-fg-2 num">
                {formatEth(app.usage.gasSponsoredWei)} ETH and{' '}
                {formatSol(app.usage.gasSponsoredLamports)} SOL sponsored this month
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setToppingUp(true);
              }}
            >
              Top up
            </Button>
          </div>
        </PaneSection>

        <PaneSection title="Chains" description="Which wallets get their gas paid.">
          <div className="divide-y divide-border">
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
        </PaneSection>

        <PaneSection
          title="Solana daily cap"
          description="Lamports the fee payer may spend per UTC day. Zero means no daily cap."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cap (lamports per day)" htmlFor={`${id}-cap`}>
              <Input
                id={`${id}-cap`}
                inputMode="numeric"
                value={cap}
                className="num"
                onChange={(event) => {
                  setCap(event.target.value);
                  setError(null);
                }}
              />
            </Field>
          </div>
        </PaneSection>

        <PaneSection title="Today">
          <div className="divide-y divide-border">
            <KeyValue label="Solana spent today">
              <span className="num">
                {balance ? formatInt(Number(balance.solanaSpentTodayLamports)) : '...'} lamports
              </span>
            </KeyValue>
            <KeyValue label="Against a cap of">
              <span className="num">
                {balance ? formatInt(Number(balance.solanaDailyCapLamports)) : '...'} lamports
              </span>
            </KeyValue>
          </div>
        </PaneSection>
      </div>

      <TopUpDialog appId={app.app.id} open={toppingUp} onOpenChange={setToppingUp} />
    </Pane>
  );
}
