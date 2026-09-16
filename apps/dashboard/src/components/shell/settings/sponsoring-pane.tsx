'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { SwitchRow } from '@/components/ui/switch';
import { formatEth, formatUsd } from '@/lib/format';
import { sponsoring, type AppSummary } from '@/lib/mock-data';
import { KeyValue, Pane, PaneSection, SavedHint } from './pane';

export function SponsoringPane({ app }: { app: AppSummary }) {
  const id = useId();
  const [balance, setBalance] = useState(sponsoring.balanceUsd);
  const [dailyCap, setDailyCap] = useState(String(sponsoring.dailyCapUsd));
  const [perUserCap, setPerUserCap] = useState(String(sponsoring.perUserDailyCapUsd));
  const [evm, setEvm] = useState(app.app.config.gasSponsoring.evm);
  const [solana, setSolana] = useState(app.app.config.gasSponsoring.solana);
  const [saved, setSaved] = useState(false);

  return (
    <Pane
      title="Sponsoring"
      actions={
        <>
          <SavedHint visible={saved} />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              // TODO(T5.3): PATCH sponsoring caps and gasSponsoring flags.
              setSaved(true);
              setTimeout(() => {
                setSaved(false);
              }, 1500);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="divide-y divide-border">
        <PaneSection title="Balance" description="Prepaid balance used to pay gas for your users.">
          <div className="flex items-center justify-between gap-4 rounded-[12px] bg-surface-2 px-4 py-3.5 shadow-border">
            <div>
              <p className="text-2xl font-medium leading-none num">{formatUsd(balance)}</p>
              <p className="mt-1.5 text-[13px] text-fg-2 num">
                {formatEth(sponsoring.sponsoredThisMonthWei)} ETH sponsored this month
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                // TODO(T5.4): open the Stripe checkout for a top up.
                setBalance((value) => value + 100);
              }}
            >
              Top up
            </Button>
          </div>
        </PaneSection>

        <PaneSection
          title="Daily caps"
          description="Sponsoring stops for the day once a cap is hit."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="App cap (USD per day)" htmlFor={`${id}-cap`}>
              <Input
                id={`${id}-cap`}
                inputMode="decimal"
                value={dailyCap}
                className="num"
                onChange={(event) => {
                  setDailyCap(event.target.value);
                }}
              />
            </Field>
            <Field label="Per user cap (USD per day)" htmlFor={`${id}-user-cap`}>
              <Input
                id={`${id}-user-cap`}
                inputMode="decimal"
                value={perUserCap}
                className="num"
                onChange={(event) => {
                  setPerUserCap(event.target.value);
                }}
              />
            </Field>
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
              description="Fee payer on mainnet-beta, capped in lamports."
              checked={solana}
              onCheckedChange={setSolana}
            />
          </div>
        </PaneSection>

        <PaneSection title="Details">
          <div className="divide-y divide-border">
            <KeyValue label="Solana daily cap">
              <span className="num">
                {app.app.config.gasSponsoring.solanaDailyCapLamports} lamports
              </span>
            </KeyValue>
          </div>
        </PaneSection>
      </div>
    </Pane>
  );
}
