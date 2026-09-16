'use client';

import { Fuel } from 'lucide-react';
import { useId, useState } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { SwitchRow } from '@/components/ui/switch';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, formatEth, formatRelative, formatUsd, truncateMiddle } from '@/lib/format';
import { sponsoredTxs, sponsoring, type AppSummary } from '@/lib/mock-data';

export function SponsoringView({ app }: { app: AppSummary }) {
  const id = useId();
  const [balance, setBalance] = useState(sponsoring.balanceUsd);
  const [dailyCap, setDailyCap] = useState(String(sponsoring.dailyCapUsd));
  const [perUserCap, setPerUserCap] = useState(String(sponsoring.perUserDailyCapUsd));
  const [evm, setEvm] = useState(app.app.config.gasSponsoring.evm);
  const [solana, setSolana] = useState(app.app.config.gasSponsoring.solana);
  const enabled = evm || solana;

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Sponsoring"
        description="Pay gas for your users from a prepaid balance."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              // TODO(T5.4): Stripe checkout for a top up.
              setBalance((value) => value + 100);
            }}
          >
            Top up
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card accent>
          <p className="text-[13px] text-fg-2">Balance</p>
          <p className="mt-1.5 text-2xl font-medium leading-none num">{formatUsd(balance)}</p>
          <p className="mt-3 text-[13px] text-fg-3">
            Last top up {formatDate(sponsoring.lastTopUpAt)}
          </p>
        </Card>
        <Card accent>
          <p className="text-[13px] text-fg-2">Sponsored this month</p>
          <p className="mt-1.5 flex items-baseline gap-1.5 leading-none">
            <span className="text-2xl font-medium num">
              {formatEth(sponsoring.sponsoredThisMonthWei)}
            </span>
            <span className="text-[13px] text-fg-3">ETH</span>
          </p>
          <p className="mt-3 text-[13px] text-fg-3 num">
            {sponsoredTxs.length} transactions in the last 48h
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
            description="Fee payer on mainnet-beta, capped in lamports."
            checked={solana}
            onCheckedChange={setSolana}
          />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium">Daily caps</p>
        <p className="mt-0.5 text-[13px] text-fg-2">
          Sponsoring stops for the day once a cap is reached. Users keep signing, they pay gas.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={() => {
              // TODO(T5.3): PATCH caps on the admin API.
            }}
          >
            Save caps
          </Button>
        </div>
      </Card>

      <Card flush>
        <p className="px-5 pt-5 text-sm font-medium">Recent sponsored transactions</p>
        {!enabled || sponsoredTxs.length === 0 ? (
          <EmptyState
            icon={<Fuel strokeWidth={1.5} />}
            title={enabled ? 'No sponsored transactions yet' : 'Sponsoring is off'}
            description={
              enabled
                ? 'They show up here as soon as a user sends one.'
                : 'Enable a chain above to start paying gas for your users.'
            }
          />
        ) : (
          <Table className="mt-2">
            <thead>
              <tr>
                <Th>Transaction</Th>
                <Th>User</Th>
                <Th>Chain</Th>
                <Th className="text-right">Gas (ETH)</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody>
              {sponsoredTxs.map((tx) => (
                <tr key={tx.hash}>
                  <Td className="font-mono text-[13px]">{truncateMiddle(tx.hash, 8, 6)}</Td>
                  <Td className="text-fg-2">{tx.userIdentifier}</Td>
                  <Td className="text-fg-2">{tx.chain}</Td>
                  <Td className="text-right num">{formatEth(tx.gasWei, 6)}</Td>
                  <Td className="text-right text-fg-2 num">{formatRelative(tx.at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
