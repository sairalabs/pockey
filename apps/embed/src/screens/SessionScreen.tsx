import type { ChainFamily } from '@pockey/types';
import { clsx } from 'clsx';
import { ChevronDown, TriangleAlert } from '../components/icons';
import { useId, useState } from 'react';
import { DetailList, DetailRow, WalletAddress } from '../components/Details';
import { ErrorText, OriginChip, ScreenLayout } from '../components/ScreenLayout';
import {
  formatAddress,
  formatDateTime,
  formatDuration,
  formatPolicyAmount,
  hostOf,
  policyNetworks,
  type AmountView,
} from '../lib/format';
import { ConfirmFooter } from './ConfirmScreens';
import type { ScreenProps } from './types';

const COLLAPSED_ADDRESSES = 3;

function AmountRow({ label, amount }: { label: string; amount: AmountView }) {
  return (
    <DetailRow label={label}>
      <span className="tabular-nums" title={amount.full}>
        {amount.short}
      </span>
    </DetailRow>
  );
}

/** Label with a count, the first addresses, and a toggle for the rest. */
function AllowlistRow({
  label,
  addresses,
  family,
}: {
  label: string;
  addresses: readonly string[];
  family: ChainFamily;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hidden = addresses.length - COLLAPSED_ADDRESSES;
  const visible = expanded ? addresses : addresses.slice(0, COLLAPSED_ADDRESSES);
  return (
    <div className="flex justify-between gap-4 py-1.5">
      {/* The toggle sits under the label, in space the address column leaves empty. */}
      <dt className="flex shrink-0 flex-col items-start">
        <span className="flex h-8 items-center gap-2 text-[13px] text-fg-2">
          {label}
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-3 px-1.5 text-[12px] font-medium text-fg-2 tabular-nums">
            {addresses.length}
          </span>
        </span>
        {hidden > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              setExpanded((value) => !value);
            }}
            className="-my-1 -ml-2 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-fg tabular-nums hover:text-fg-2"
          >
            {expanded ? 'Show less' : `Show ${String(hidden)} more`}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={clsx('text-fg-2', expanded && 'rotate-180')}
            />
          </button>
        ) : null}
      </dt>
      <dd className="flex min-w-0 flex-col items-end py-1">
        <ul id={listId} className="flex flex-col items-end">
          {visible.map((address) => (
            <li
              key={address}
              className="text-[13px] leading-6 text-fg tabular-nums"
              title={address}
            >
              {formatAddress(address, family)}
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

export function SessionScreen({ screen, actions, app, titleId }: ScreenProps<'session'>) {
  const { policy, wallet } = screen;
  const perTx =
    policy.maxValuePerTx === undefined ? null : formatPolicyAmount(policy.maxValuePerTx, policy);
  const total =
    policy.maxValueTotal === undefined ? null : formatPolicyAmount(policy.maxValueTotal, policy);
  const networks = policyNetworks(policy);
  const contracts = policy.chain === 'evm' ? (policy.allowedContracts ?? []) : [];
  const programs = policy.chain === 'solana' ? (policy.allowedPrograms ?? []) : [];

  return (
    <ScreenLayout
      titleId={titleId}
      title="Allow automatic signing"
      subtitle={
        perTx === null && total === null
          ? `${app.name} will sign without asking you each time.`
          : `${app.name} will sign without asking you each time, within these limits.`
      }
      meta={<OriginChip origin={hostOf(screen.origin)} />}
      onClose={actions.dismiss}
      status={screen.error ? <ErrorText>{screen.error.message}</ErrorText> : null}
      footer={
        <>
          <ConfirmFooter
            status={screen.status}
            error={screen.error}
            primaryLabel="Allow"
            cancelLabel="Deny"
            actions={actions}
          />
          <p className="mt-3 text-center text-[13px] leading-5 text-fg-3">
            You can revoke this at any time.
          </p>
        </>
      }
    >
      <DetailList>
        <DetailRow label="Wallet">
          <WalletAddress wallet={wallet} />
        </DetailRow>
        <DetailRow label="Duration" align="start">
          <span className="flex flex-col items-end py-1">
            <span className="leading-6 tabular-nums">{formatDuration(policy.expiresIn)}</span>
            <span className="text-[13px] leading-5 text-fg-2 tabular-nums">
              Until {formatDateTime(screen.expiresAt)}
            </span>
          </span>
        </DetailRow>
        {networks !== null ? (
          <DetailRow label="Networks" align="start">
            <span className="py-1 leading-6 text-pretty">{networks}</span>
          </DetailRow>
        ) : null}
        {perTx ? <AmountRow label="Per transaction" amount={perTx} /> : null}
        {total ? <AmountRow label="Total" amount={total} /> : null}
        {contracts.length > 0 ? (
          <AllowlistRow label="Contracts" addresses={contracts} family="evm" />
        ) : null}
        {programs.length > 0 ? (
          <AllowlistRow label="Programs" addresses={programs} family="solana" />
        ) : null}
        <DetailRow label="Signs">
          <span className="leading-6">
            {policy.allowMessages === true ? 'Transactions and messages' : 'Transactions only'}
          </span>
        </DetailRow>
      </DetailList>
      {perTx === null && total === null ? (
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-danger/8 px-4 py-3">
          <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] leading-5 text-pretty text-fg-2">
            <span className="font-medium text-danger">No spending limit.</span> Only allow apps you
            trust.
          </p>
        </div>
      ) : null}
    </ScreenLayout>
  );
}
