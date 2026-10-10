import type { Wallet } from '@pockey/types';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { formatAddress } from '../lib/format';
import { EthereumIcon, SolanaIcon } from './icons';

/** Grouped key/value rows on surface-2, hairline dividers between rows. */
export function DetailList({ children }: { children: ReactNode }) {
  return (
    <dl className="divide-y divide-ring rounded-xl bg-surface-2 px-4 shadow-[inset_0_0_0_1px_var(--ring)]">
      {children}
    </dl>
  );
}

export function DetailRow({
  label,
  children,
  align = 'center',
}: {
  label: string;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={clsx(
        'flex min-h-11 justify-between gap-4 py-1.5',
        align === 'center' ? 'items-center' : 'items-start',
      )}
    >
      <dt className="shrink-0 text-[13px] leading-8 text-fg-2">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1 text-right text-[15px] leading-8 text-fg">
        {children}
      </dd>
    </div>
  );
}

export function ChainIcon({ family }: { family: Wallet['chainFamily'] }) {
  return family === 'evm' ? (
    <EthereumIcon size={16} className="shrink-0 text-fg-2" />
  ) : (
    <SolanaIcon size={16} className="shrink-0 text-fg-2" />
  );
}

export function WalletAddress({ wallet }: { wallet: Wallet }) {
  return (
    <span className="flex min-w-0 items-center gap-2" title={wallet.address}>
      <ChainIcon family={wallet.chainFamily} />
      <span className="text-[13px] tabular-nums">
        {formatAddress(wallet.address, wallet.chainFamily)}
      </span>
    </span>
  );
}

/** Cancel secondary and primary action, full width row, 8px gap. */
export function ConfirmButtons({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 [&>*]:flex-1">{children}</div>;
}
