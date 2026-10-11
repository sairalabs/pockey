'use client';

import { usePockey, useSign, useWallet } from '@pockey/react';
import { useCallback, useState, type ReactNode } from 'react';

interface LogEntry {
  id: number;
  label: string;
  ok: boolean;
  ms: number;
  output: string;
}

function utf8ToBase64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error ? ` (${String((error as { code: unknown }).code)})` : '';
    return `${error.message}${code}`;
  }
  return String(error);
}

function Card({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="rounded-2xl bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-fg-2">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Button({
  children,
  onClick,
  disabled,
  primary,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={
        (primary ? 'bg-accent text-white ' : 'bg-surface-2 text-fg ') +
        'h-10 rounded-xl px-4 text-sm font-medium transition-[transform,opacity] duration-150 ease-out active:scale-[0.96] disabled:opacity-40'
      }
    >
      {children}
    </button>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-fg-2">{label}</span>
      <span data-testid={testId} className="num truncate tabular-nums">
        {value}
      </span>
    </div>
  );
}

export default function Playground() {
  const { ready, authenticated, user, login, logout, registerPasskey } = usePockey();
  const { wallets, evm, solana, createWallet, exportWallet } = useWallet();
  const { signMessage, signTypedData, sendTransaction } = useSign();
  const [message, setMessage] = useState('gm from the Pockey playground');
  const [log, setLog] = useState<LogEntry[]>([]);

  const run = useCallback(async (label: string, action: () => Promise<unknown>) => {
    const started = performance.now();
    try {
      const output = await action();
      setLog((entries) => [
        {
          id: Date.now(),
          label,
          ok: true,
          ms: Math.round(performance.now() - started),
          output: stringify(output),
        },
        ...entries,
      ]);
    } catch (error) {
      setLog((entries) => [
        {
          id: Date.now(),
          label,
          ok: false,
          ms: Math.round(performance.now() - started),
          output: errorText(error),
        },
        ...entries,
      ]);
    }
  }, []);

  const evmWallet = wallets.find((wallet) => wallet.chainFamily === 'evm');
  const solanaWallet = wallets.find((wallet) => wallet.chainFamily === 'solana');

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pockey playground</h1>
          <p className="text-sm text-fg-2">
            Every hook of @pockey/react against the local API and embed.
          </p>
        </div>
        <span data-testid="status" className="rounded-full bg-surface-2 px-3 py-1 text-xs">
          {!ready ? 'Loading' : authenticated ? 'Signed in' : 'Signed out'}
        </span>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Session" testId="session-card">
          {authenticated && user ? (
            <>
              <Row label="User" value={user.id} testId="user-id" />
              <Row
                label="Identity"
                value={user.identities
                  .map((identity) => `${identity.type}:${identity.identifier}`)
                  .join(', ')}
                testId="user-identity"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  testId="register-passkey"
                  onClick={() => void run('registerPasskey', registerPasskey)}
                >
                  Add a passkey
                </Button>
                <Button testId="logout" onClick={() => void run('logout', logout)}>
                  Log out
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                primary
                testId="login"
                disabled={!ready}
                onClick={() => void run('login', () => login())}
              >
                Log in
              </Button>
              <Button
                disabled={!ready}
                onClick={() => void run('login email', () => login({ method: 'email' }))}
              >
                Email only
              </Button>
              <Button
                disabled={!ready}
                onClick={() => void run('login wallet', () => login({ method: 'wallet' }))}
              >
                Wallet only
              </Button>
            </div>
          )}
        </Card>

        <Card title="Wallets" testId="wallets-card">
          <Row label="EVM" value={evm?.address ?? 'none'} testId="evm-address" />
          <Row label="EVM chain" value={evm ? String(evm.chainId) : 'none'} />
          <Row label="Solana" value={solana?.publicKey ?? 'none'} testId="solana-address" />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!authenticated || Boolean(evmWallet)}
              onClick={() => void run('createWallet evm', () => createWallet('evm'))}
            >
              Create EVM
            </Button>
            <Button
              disabled={!authenticated || Boolean(solanaWallet)}
              onClick={() => void run('createWallet solana', () => createWallet('solana'))}
            >
              Create Solana
            </Button>
            <Button
              disabled={!evmWallet}
              onClick={() => void run('exportWallet', () => exportWallet('evm'))}
            >
              Export EVM key
            </Button>
          </div>
        </Card>

        <Card title="Sign" testId="sign-card">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-fg-2">Message</span>
            <input
              data-testid="message-input"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              className="h-10 rounded-xl bg-surface-2 px-3 tabular-nums text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              primary
              testId="sign-evm"
              disabled={!evmWallet}
              onClick={() =>
                void run('signMessage evm', () => signMessage({ chain: 'evm', message }))
              }
            >
              Sign (EVM)
            </Button>
            <Button
              disabled={!solanaWallet}
              onClick={() =>
                void run('signMessage solana', () =>
                  signMessage({ chain: 'solana', message: utf8ToBase64(message) }),
                )
              }
            >
              Sign (Solana)
            </Button>
            <Button
              disabled={!evmWallet}
              onClick={() =>
                void run('signTypedData', () =>
                  signTypedData({
                    chain: 'evm',
                    domain: { name: 'Pockey Playground', version: '1', chainId: 84532 },
                    types: { Greeting: [{ name: 'text', type: 'string' }] },
                    primaryType: 'Greeting',
                    message: { text: message },
                  }),
                )
              }
            >
              Sign typed data
            </Button>
          </div>
        </Card>

        <Card title="Transactions and EIP-1193" testId="tx-card">
          <p className="text-sm text-fg-2">
            Mock keys hold no funds, so broadcasts are expected to fail at the RPC. The confirmation
            screen still shows.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!evm}
              onClick={() =>
                void run('sendTransaction base-sepolia', () =>
                  sendTransaction({
                    chain: 'evm',
                    chainId: 84532,
                    to: '0x4200000000000000000000000000000000000006',
                    value: '1000000000000',
                    data: '0x',
                    sponsored: false,
                  }),
                )
              }
            >
              Send 0.000001 ETH
            </Button>
            <Button
              testId="eip1193-chain"
              disabled={!evm}
              onClick={() =>
                void run('eth_chainId', async () =>
                  evm?.getProvider().request({ method: 'eth_chainId' }),
                )
              }
            >
              eth_chainId
            </Button>
            <Button
              disabled={!evm}
              onClick={() =>
                void run('personal_sign', async () =>
                  evm
                    ?.getProvider()
                    .request({ method: 'personal_sign', params: [message, evm.address] }),
                )
              }
            >
              personal_sign
            </Button>
          </div>
        </Card>
      </div>

      <section className="rounded-2xl bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-2">Results</h2>
          <button
            type="button"
            className="text-xs text-fg-2"
            onClick={() => {
              setLog([]);
            }}
          >
            Clear
          </button>
        </div>
        <ol data-testid="log" className="flex flex-col gap-3">
          {log.length === 0 && <li className="text-sm text-fg-2">Nothing yet.</li>}
          {log.map((entry) => (
            <li key={entry.id} data-testid="log-entry" data-label={entry.label} data-ok={entry.ok}>
              <div className="flex items-center justify-between text-sm">
                <span className={entry.ok ? 'text-ok' : 'text-danger'}>{entry.label}</span>
                <span className="num text-xs text-fg-2">{entry.ms} ms</span>
              </div>
              <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-surface-2 p-3 tabular-nums text-xs whitespace-pre-wrap break-all">
                {entry.output}
              </pre>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
