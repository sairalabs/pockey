import type { EmbedError } from '@pocketkey/types';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { CopyButton } from '../components/CopyButton';
import {
  ChainIcon,
  ConfirmButtons,
  DetailList,
  DetailRow,
  WalletAddress,
} from '../components/Details';
import { ErrorText, OriginChip, ScreenLayout } from '../components/ScreenLayout';
import {
  evmNativeSymbol,
  evmNetworkName,
  formatAddress,
  formatUnits,
  hexByteLength,
  hostOf,
  messageView,
  shortenDecimal,
  solanaNetworkName,
} from '../lib/format';
import type { ConfirmStatus, ScreenActions } from '../lib/state';
import { summarizeSolanaTransaction } from '../lib/solana-tx';
import type { ScreenProps } from './types';

export function ConfirmFooter({
  status,
  error,
  primaryLabel,
  cancelLabel = 'Cancel',
  actions,
}: {
  status: ConfirmStatus;
  error: EmbedError | null;
  primaryLabel: string;
  cancelLabel?: string;
  actions: ScreenActions;
}) {
  const pending = status === 'pending';
  return (
    <ConfirmButtons>
      <Button testId="pk-confirm-cancel" onClick={actions.cancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button
        variant="primary"
        testId="pk-confirm-approve"
        pending={pending}
        onClick={() => {
          if (!pending) actions.approve();
        }}
      >
        {error ? 'Try again' : primaryLabel}
      </Button>
    </ConfirmButtons>
  );
}

function MessageBox({
  children,
  label,
  aside,
}: {
  children: ReactNode;
  label: string;
  aside?: ReactNode;
}) {
  return (
    <section className="mt-3">
      <div className="mb-2 flex h-7 items-center justify-between">
        <h3 className="text-[13px] leading-5 text-fg-2">{label}</h3>
        {aside}
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={label}
        className="max-h-[200px] overflow-y-auto overscroll-contain rounded-xl bg-surface-2 px-4 py-3 text-[14px] leading-5 break-words whitespace-pre-wrap text-fg shadow-[inset_0_0_0_1px_var(--ring)]"
      >
        {children}
      </div>
    </section>
  );
}

function HexToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={clsx(
        'pk-press -my-2 -mr-2 h-10 px-2 text-[13px] font-medium',
        pressed ? 'text-fg' : 'text-fg-2 hover:text-fg',
      )}
    >
      <span
        className={clsx(
          'inline-flex h-6 items-center rounded-full px-2.5',
          pressed ? 'bg-surface-3' : 'bg-surface-2',
        )}
      >
        Hex
      </span>
    </button>
  );
}

export function SignMessageScreen({ screen, actions, titleId }: ScreenProps<'signMessage'>) {
  const view = messageView(screen.input);
  const [showHex, setShowHex] = useState(false);
  const canToggle = view.text !== null && view.hex !== null;
  const body = showHex || view.text === null ? (view.hex ?? '') : view.text;
  return (
    <ScreenLayout
      titleId={titleId}
      title="Sign message"
      meta={<OriginChip origin={hostOf(screen.origin)} />}
      onClose={actions.dismiss}
      status={screen.error ? <ErrorText>{screen.error.message}</ErrorText> : null}
      footer={
        <ConfirmFooter
          status={screen.status}
          error={screen.error}
          primaryLabel="Sign"
          actions={actions}
        />
      }
    >
      <DetailList>
        <DetailRow label="Wallet">
          <WalletAddress wallet={screen.wallet} />
        </DetailRow>
      </DetailList>
      <MessageBox
        label="Message"
        aside={
          canToggle ? (
            <HexToggle
              pressed={showHex}
              onToggle={() => {
                setShowHex((value) => !value);
              }}
            />
          ) : null
        }
      >
        {body}
      </MessageBox>
    </ScreenLayout>
  );
}

const SHORT_VALUE = 20;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function TypedValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (value.length <= SHORT_VALUE) {
    return <span className="text-[13px] tabular-nums">{value}</span>;
  }
  const collapsed = EVM_ADDRESS.test(value) ? formatAddress(value, 'evm') : null;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? `${value}, collapse` : `${value}, expand`}
      onClick={() => {
        setExpanded((current) => !current);
      }}
      className="min-w-0 rounded-md text-right text-[13px] text-fg tabular-nums hover:text-fg-2"
    >
      {expanded ? (
        <span className="break-all">{value}</span>
      ) : (
        <span className="block truncate">{collapsed ?? value}</span>
      )}
    </button>
  );
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (value === null || value === undefined) return String(value);
  return JSON.stringify(value);
}

function TypedEntries({ entries, depth }: { entries: [string, unknown][]; depth: number }) {
  return (
    <div className={clsx(depth > 0 && 'ml-1 border-l border-ring pl-3')}>
      {entries.map(([key, value]) => {
        const nested = depth === 0 && typeof value === 'object' && value !== null;
        return nested ? (
          <div key={key} className="py-1.5">
            <div className="text-[13px] leading-6 text-fg-2">{key}</div>
            <TypedEntries entries={Object.entries(value)} depth={1} />
          </div>
        ) : (
          <div key={key} className="flex min-h-8 items-start justify-between gap-4 py-1">
            <span className="shrink-0 text-[13px] leading-6 text-fg-2">{key}</span>
            <span className="flex min-w-0 justify-end leading-6">
              <TypedValue value={stringify(value)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SignTypedDataScreen({ screen, actions, titleId }: ScreenProps<'signTypedData'>) {
  const { domain, primaryType, message } = screen.input;
  return (
    <ScreenLayout
      titleId={titleId}
      title="Sign data"
      meta={<OriginChip origin={hostOf(screen.origin)} />}
      onClose={actions.dismiss}
      status={screen.error ? <ErrorText>{screen.error.message}</ErrorText> : null}
      footer={
        <ConfirmFooter
          status={screen.status}
          error={screen.error}
          primaryLabel="Sign"
          actions={actions}
        />
      }
    >
      <DetailList>
        <DetailRow label="Wallet">
          <WalletAddress wallet={screen.wallet} />
        </DetailRow>
      </DetailList>
      <section
        className="mt-3 rounded-xl bg-surface-2 px-4 py-3 shadow-[inset_0_0_0_1px_var(--ring)]"
        aria-label="Typed data"
      >
        <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-ring pb-2">
          <span className="truncate text-[15px] font-medium text-fg">
            {domain.name ?? 'Unknown app'}
          </span>
          <span className="shrink-0 text-[13px] text-fg-2">{primaryType}</span>
        </div>
        <TypedEntries entries={Object.entries(message)} depth={0} />
      </section>
    </ScreenLayout>
  );
}

function DataRow({ data }: { data: string }) {
  const [open, setOpen] = useState(false);
  const bytes = hexByteLength(data);
  if (bytes === 0) {
    return (
      <DetailRow label="Data">
        <span className="tabular-nums">None</span>
      </DetailRow>
    );
  }
  return (
    <div className="py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex min-h-8 w-full items-center justify-between gap-4 text-left"
      >
        <span className="text-[13px] text-fg-2">Data</span>
        <span className="flex items-center gap-1 text-[15px] text-fg tabular-nums">
          {bytes} bytes
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className={clsx('text-fg-2', open && 'rotate-180')}
          />
        </span>
      </button>
      {open ? (
        <div className="mt-2 max-h-[160px] overflow-y-auto rounded-lg bg-surface px-3 py-2 text-[12px] leading-5 break-all text-fg-2">
          {data}
        </div>
      ) : null}
    </div>
  );
}

export function TransactionScreen({ screen, actions, titleId }: ScreenProps<'transaction'>) {
  const { input, wallet } = screen;
  const sponsored = 'sponsored' in input && input.sponsored;

  let rows: ReactNode;
  if (input.chain === 'evm') {
    const symbol = evmNativeSymbol(input.chainId);
    const full = formatUnits(BigInt(input.value), 18);
    rows = (
      <>
        <DetailRow label="To">
          <span className="text-[13px] tabular-nums" title={input.to}>
            {formatAddress(input.to, 'evm')}
          </span>
          <span className="-my-1 -mr-3">
            <CopyButton value={input.to} label="Copy address" />
          </span>
        </DetailRow>
        <DetailRow label="Amount">
          <span className="tabular-nums" title={`${full} ${symbol}`}>
            {shortenDecimal(full)} {symbol}
          </span>
        </DetailRow>
        <DetailRow label="Network">
          <ChainIcon family="evm" />
          <span>{evmNetworkName(input.chainId)}</span>
        </DetailRow>
        <DataRow data={input.data} />
      </>
    );
  } else {
    const summary = summarizeSolanaTransaction(input.transaction, wallet.address);
    const full =
      summary && summary.lamportsOut !== null ? formatUnits(summary.lamportsOut, 9) : null;
    rows = (
      <>
        {full !== null ? (
          <DetailRow label="Amount">
            <span className="tabular-nums" title={`${full} SOL`}>
              {shortenDecimal(full)} SOL
            </span>
          </DetailRow>
        ) : null}
        <DetailRow label="Network">
          <ChainIcon family="solana" />
          <span>{solanaNetworkName(input.cluster)}</span>
        </DetailRow>
        <DetailRow label="Instructions">
          <span className="tabular-nums">{summary ? summary.instructionCount : 'Unknown'}</span>
        </DetailRow>
      </>
    );
  }

  return (
    <ScreenLayout
      titleId={titleId}
      title="Confirm transaction"
      meta={<OriginChip origin={hostOf(screen.origin)} />}
      onClose={actions.dismiss}
      status={screen.error ? <ErrorText>{screen.error.message}</ErrorText> : null}
      footer={
        <ConfirmFooter
          status={screen.status}
          error={screen.error}
          primaryLabel={screen.kind === 'send' ? 'Send' : 'Sign'}
          actions={actions}
        />
      }
    >
      <DetailList>
        <DetailRow label="From">
          <WalletAddress wallet={wallet} />
        </DetailRow>
        {rows}
        {sponsored ? (
          <DetailRow label="Network fee">
            <span>Sponsored</span>
          </DetailRow>
        ) : null}
      </DetailList>
    </ScreenLayout>
  );
}
