import { render, act, type RenderResult } from '@testing-library/react';
import {
  DEFAULT_APPEARANCE,
  type EndUser,
  type HostRequest,
  type HostRequestType,
  type PublicAppConfig,
  type Wallet,
} from '@pockey/types';
import { StrictMode, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { PockeyConfig } from '../config.js';
import { usePockey, useSign, useWallet } from '../hooks.js';
import { PockeyProvider } from '../provider.js';

/** Served by the happy-dom virtual server configured in vitest.config.ts. */
export const EMBED_URL = 'https://embed.pockey.test';
export const EMBED_ORIGIN = 'https://embed.pockey.test';
export const APP_ID = `pk_app_${'a'.repeat(24)}`;

export const EVM_ADDRESS = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
/** Wrapped SOL mint: a real 32-byte base58 public key. */
export const SOLANA_ADDRESS = 'So11111111111111111111111111111111111111112';

const id = (prefix: string, fill: string) => `${prefix}_${fill.repeat(24)}`;
export const EVM_WALLET_ID = id('wlt', 'e');
export const SOLANA_WALLET_ID = id('wlt', 's');
const NOW = '2026-09-16T12:00:00.000Z';

export function makeWallet(chainFamily: 'evm' | 'solana'): Wallet {
  return {
    id: chainFamily === 'evm' ? EVM_WALLET_ID : SOLANA_WALLET_ID,
    endUserId: id('usr', 'u'),
    chainFamily,
    address: chainFamily === 'evm' ? EVM_ADDRESS : SOLANA_ADDRESS,
    smartAccountAddress: null,
    createdAt: NOW,
  } as Wallet;
}

export function makeUser(families: ('evm' | 'solana')[] = ['evm', 'solana']): EndUser {
  return {
    id: id('usr', 'u'),
    appId: id('app', 'a'),
    identities: [
      { id: id('idn', 'i'), type: 'email', identifier: 'ada@example.com', verifiedAt: NOW },
    ],
    wallets: families.map(makeWallet),
    createdAt: NOW,
    lastActiveAt: null,
  } as EndUser;
}

export function makeServerConfig(overrides: Partial<PublicAppConfig> = {}): PublicAppConfig {
  return {
    appId: APP_ID,
    name: 'Test app',
    loginMethods: ['email', 'passkey'],
    chains: { evm: [8453], solana: ['devnet'] },
    appearance: DEFAULT_APPEARANCE,
    embeddedWallets: { createOnLogin: 'all' },
    allowedOrigins: ['https://app.example.com'],
    keyProvider: {
      kind: 'emulator',
      organizationId: 'org-parent',
      signerPublicKey: '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    ...overrides,
  } as PublicAppConfig;
}

export type Reply =
  { data: unknown } | { error: { code: string; message: string; reason?: string } } | 'ignore';

type Handler = (request: HostRequest) => Reply;

/**
 * Plays the embed side of the protocol: intercepts the host's postMessage calls on the
 * iframe window and answers by dispatching MessageEvents from the embed origin.
 */
export class FakeEmbed {
  readonly received: HostRequest[] = [];
  readonly targetOrigins: string[] = [];
  readonly window: Window;
  private readonly handlers = new Map<HostRequestType, Handler>();

  constructor(readonly iframe: HTMLIFrameElement) {
    const contentWindow = iframe.contentWindow;
    if (!contentWindow) throw new Error('iframe has no contentWindow');
    this.window = contentWindow;
    const postMessage = vi.fn((message: HostRequest, targetOrigin: string) => {
      this.received.push(message);
      this.targetOrigins.push(targetOrigin);
      const handler = this.handlers.get(message.type);
      if (!handler) return;
      const reply = handler(message);
      if (reply === 'ignore') return;
      queueMicrotask(() => {
        if ('data' in reply) this.respond(message.requestId, reply.data);
        else
          this.fail(message.requestId, reply.error.code, reply.error.message, reply.error.reason);
      });
    });
    contentWindow.postMessage = postMessage as unknown as Window['postMessage'];

    this.handle('init', () => ({ data: { user: null, config: makeServerConfig() } }));
    this.handle('logout', () => ({ data: { ok: true } }));
    this.handle('close', () => ({ data: { ok: true } }));
  }

  static fromDocument(): FakeEmbed {
    const iframes = document.querySelectorAll('iframe');
    const iframe = iframes[iframes.length - 1];
    if (!iframe) throw new Error('No iframe mounted');
    return new FakeEmbed(iframe);
  }

  handle(type: HostRequestType, handler: Handler): this {
    this.handlers.set(type, handler);
    return this;
  }

  requestsOf(type: HostRequestType): HostRequest[] {
    return this.received.filter((request) => request.type === type);
  }

  last(type: HostRequestType): HostRequest {
    const request = this.requestsOf(type).at(-1);
    if (!request) throw new Error(`No ${type} request received`);
    return request;
  }

  send(
    data: Record<string, unknown>,
    options: { origin?: string; source?: MessageEventSource | null } = {},
  ): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'pockey', pk: 1, ...data },
        origin: options.origin ?? EMBED_ORIGIN,
        source: options.source === undefined ? this.window : options.source,
      }),
    );
  }

  ready(): void {
    this.send({ type: 'ready' });
  }

  respond(requestId: string, data: unknown): void {
    this.send({ type: 'response', requestId, ok: true, data });
  }

  fail(requestId: string, code: string, message = code, reason?: string): void {
    const error = reason === undefined ? { code, message } : { code, message, reason };
    this.send({ type: 'response', requestId, ok: false, error });
  }
}

/** Lets queued microtasks (fake embed replies) and promise chains settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

export interface HookValues {
  pockey: ReturnType<typeof usePockey>;
  wallet: ReturnType<typeof useWallet>;
  sign: ReturnType<typeof useSign>;
}

export interface Harness {
  embed: FakeEmbed;
  result: RenderResult;
  /** Latest hook values. */
  hooks: () => HookValues;
  /** Every hook value rendered, oldest first. */
  history: HookValues[];
  rerender: (config?: PockeyConfig) => void;
}

function Probe({ history }: { history: HookValues[] }) {
  const pockey = usePockey();
  const wallet = useWallet();
  const sign = useSign();
  history.push({ pockey, wallet, sign });
  return null;
}

export interface HarnessOptions {
  config?: PockeyConfig;
  strict?: boolean;
  initUser?: EndUser | null;
  serverConfig?: PublicAppConfig;
  /** Set up handlers before the embed announces `ready`. */
  setup?: (embed: FakeEmbed) => void;
  autoReady?: boolean;
  children?: ReactNode;
}

export async function renderPockey(options: HarnessOptions = {}): Promise<Harness> {
  const history: HookValues[] = [];
  const tree = (config: PockeyConfig | undefined) => {
    const provider = (
      <PockeyProvider appId={APP_ID} embedUrl={EMBED_URL} {...(config ? { config } : {})}>
        <Probe history={history} />
        {options.children}
      </PockeyProvider>
    );
    return options.strict ? <StrictMode>{provider}</StrictMode> : provider;
  };
  const result = render(tree(options.config));
  const embed = FakeEmbed.fromDocument();
  // Let happy-dom finish loading the blank embed page, so unmounting later does not abort a fetch.
  await new Promise<void>((resolve) => {
    embed.iframe.addEventListener(
      'load',
      () => {
        resolve();
      },
      { once: true },
    );
  });
  const serverConfig = options.serverConfig ?? makeServerConfig();
  embed.handle('init', () => ({ data: { user: options.initUser ?? null, config: serverConfig } }));
  options.setup?.(embed);
  if (options.autoReady !== false) {
    await act(async () => {
      embed.ready();
      await flush();
    });
  }
  return {
    embed,
    result,
    history,
    hooks: () => {
      const latest = history.at(-1);
      if (!latest) throw new Error('Probe never rendered');
      return latest;
    },
    rerender: (config) => {
      result.rerender(tree(config));
    },
  };
}
