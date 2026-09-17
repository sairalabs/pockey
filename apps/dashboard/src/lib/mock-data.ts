/**
 * Mocked dashboard data for one developer.
 *
 * TODO(T5.1): replace every export here with data fetched from the admin API
 * (apps, keys, members) and TODO(T5.3) for usage, users and sponsoring.
 * Nothing in this file performs a network call.
 */
import {
  App,
  AppConfig,
  type AppId,
  type ApiKeyId,
  type EndUserId,
  type LoginMethod,
  type WalletId,
} from '@pocketkey/types';

/* ---------- Developer ---------- */

export interface Developer {
  id: string;
  email: string;
  name: string;
  /** Wallet the developer signed in with (mocked, mirrors the reference account row). */
  address: string;
  createdAt: string;
}

export const developer: Developer = {
  id: 'dev_seed00000000000000000001',
  email: 'you@pocketkey.dev',
  name: 'Medhy',
  address: '0x91CD4e6f0f5c0F2f0c4E1B7a9c2d3e4f5a6b99df',
  createdAt: '2026-06-02T09:12:00.000Z',
};

/* ---------- Apps ---------- */

export const PLAYGROUND_APP_ID = 'app_seed00000000000000000001' as AppId;
export const PLAYGROUND_PUBLIC_ID = 'pk_app_seed00000000000000000001';

export interface AppSummary {
  app: App;
  tagline: string;
  description: string;
  /** Monthly active wallets, current month. */
  mawThisMonth: number;
}

const playground = App.parse({
  id: PLAYGROUND_APP_ID,
  publicId: PLAYGROUND_PUBLIC_ID,
  developerId: developer.id,
  name: 'Playground',
  slug: 'playground',
  allowedOrigins: ['http://localhost:3000', 'https://playground.pocketkey.dev'],
  config: {
    loginMethods: ['email', 'google', 'passkey'],
    chains: { evm: [8453, 42161], solana: ['mainnet-beta'] },
    appearance: { theme: 'system', accent: '#d2042d', name: 'Playground' },
    embeddedWallets: { createOnLogin: 'all' },
    gasSponsoring: { evm: true, solana: false, solanaDailyCapLamports: '0' },
  },
  createdAt: '2026-06-02T09:20:00.000Z',
});

const stonkbox = App.parse({
  id: 'app_seed00000000000000000002',
  publicId: 'pk_app_seed00000000000000000002',
  developerId: developer.id,
  name: 'Stonkbox',
  slug: 'stonkbox',
  allowedOrigins: ['https://stonkbox.xyz'],
  config: {
    loginMethods: ['email', 'wallet'],
    chains: { evm: [8453], solana: [] },
    appearance: { theme: 'dark', accent: '#0052ff', name: 'Stonkbox' },
    embeddedWallets: { createOnLogin: 'evm' },
    gasSponsoring: { evm: true, solana: false, solanaDailyCapLamports: '0' },
  },
  createdAt: '2026-07-18T14:03:00.000Z',
});

export const apps: readonly AppSummary[] = [
  {
    app: playground,
    tagline: 'Try Pocketkey end to end',
    description: 'Sandbox app used by the docs and the SDK examples.',
    mawThisMonth: 1284,
  },
  {
    app: stonkbox,
    tagline: 'Case opening onchain',
    description: 'Production app on Base. Email and external wallet login.',
    mawThisMonth: 3917,
  },
];

export function findApp(id: string): AppSummary | undefined {
  return apps.find((entry) => entry.app.id === id);
}

export const defaultAppConfig: AppConfig = AppConfig.parse({});

/* ---------- Usage ---------- */

export type Platform = 'web' | 'reactNative';
export type Range = '7d' | '30d';

export interface Metrics {
  activeWallets: number;
  txSigned: number;
  /** Wei, decimal string. */
  gasSponsoredWei: string;
  sessionsSigned: number;
  walletsCreated: number;
}

export interface UsagePoint {
  date: string;
  web: Metrics;
  reactNative: Metrics;
}

/** Deterministic pseudo random so the mock is stable between renders. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function buildSeries(days: number, seed: number): UsagePoint[] {
  const rand = seeded(seed);
  const end = new Date('2026-09-15T00:00:00.000Z').getTime();
  const points: UsagePoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(end - i * 86_400_000).toISOString();
    const trend = 1 + (days - i) / (days * 2);
    const web: Metrics = {
      activeWallets: Math.round((120 + rand() * 60) * trend),
      txSigned: Math.round((340 + rand() * 180) * trend),
      gasSponsoredWei: (BigInt(Math.round((2 + rand() * 3) * 1e6)) * 10n ** 12n).toString(),
      sessionsSigned: Math.round((80 + rand() * 40) * trend),
      walletsCreated: Math.round((18 + rand() * 14) * trend),
    };
    const reactNative: Metrics = {
      activeWallets: Math.round((30 + rand() * 20) * trend),
      txSigned: Math.round((70 + rand() * 50) * trend),
      gasSponsoredWei: (BigInt(Math.round((0.4 + rand() * 0.8) * 1e6)) * 10n ** 12n).toString(),
      sessionsSigned: Math.round((20 + rand() * 12) * trend),
      walletsCreated: Math.round((4 + rand() * 5) * trend),
    };
    points.push({ date, web, reactNative });
  }
  return points;
}

export const usage: Record<Range, readonly UsagePoint[]> = {
  '7d': buildSeries(7, 7),
  '30d': buildSeries(30, 30),
};

export function sumMetrics(points: readonly UsagePoint[], platform: Platform): Metrics {
  let gas = 0n;
  const total: Metrics = {
    activeWallets: 0,
    txSigned: 0,
    gasSponsoredWei: '0',
    sessionsSigned: 0,
    walletsCreated: 0,
  };
  for (const point of points) {
    const m = point[platform];
    total.activeWallets += m.activeWallets;
    total.txSigned += m.txSigned;
    total.sessionsSigned += m.sessionsSigned;
    total.walletsCreated += m.walletsCreated;
    gas += BigInt(m.gasSponsoredWei);
  }
  total.gasSponsoredWei = gas.toString();
  return total;
}

export function seriesOf(
  points: readonly UsagePoint[],
  platform: Platform,
  key: Exclude<keyof Metrics, 'gasSponsoredWei'> | 'gasSponsoredWei',
): number[] {
  return points.map((point) =>
    key === 'gasSponsoredWei'
      ? Number(BigInt(point[platform].gasSponsoredWei) / 10n ** 12n)
      : point[platform][key],
  );
}

export interface EntryPoint {
  method: LoginMethod;
  label: string;
  count: number;
}

export const entryPoints: Record<Platform, readonly EntryPoint[]> = {
  web: [
    { method: 'email', label: 'Email', count: 812 },
    { method: 'google', label: 'Google', count: 366 },
    { method: 'passkey', label: 'Passkey', count: 106 },
  ],
  reactNative: [
    { method: 'email', label: 'Email', count: 204 },
    { method: 'google', label: 'Google', count: 97 },
    { method: 'passkey', label: 'Passkey', count: 31 },
  ],
};

export interface ActionStat {
  label: string;
  count: number;
}

export const actions: Record<Platform, readonly ActionStat[]> = {
  web: [
    { label: 'Sign message', count: 1_902 },
    { label: 'Send transaction', count: 2_614 },
    { label: 'Create session', count: 611 },
  ],
  reactNative: [
    { label: 'Sign message', count: 402 },
    { label: 'Send transaction', count: 588 },
    { label: 'Create session', count: 143 },
  ],
};

/* ---------- Sponsoring ---------- */

export interface Sponsoring {
  balanceUsd: number;
  dailyCapUsd: number;
  perUserDailyCapUsd: number;
  /** Total sponsored this month, wei. */
  sponsoredThisMonthWei: string;
  lastTopUpAt: string;
}

export const sponsoring: Sponsoring = {
  balanceUsd: 248.4,
  dailyCapUsd: 50,
  perUserDailyCapUsd: 2,
  sponsoredThisMonthWei: '41200000000000000',
  lastTopUpAt: '2026-09-01T08:00:00.000Z',
};

export interface SponsoredTx {
  hash: string;
  userIdentifier: string;
  chain: string;
  /** Wei, decimal string. */
  gasWei: string;
  at: string;
}

export const sponsoredTxs: readonly SponsoredTx[] = [
  {
    hash: '0x8f1c2a7d4b6e9c0f3a5d7b9e1c3f5a7d9b1e3c5f7a9d1b3e5c7f9a1d3b5e7c9f',
    userIdentifier: 'ada@example.com',
    chain: 'Base',
    gasWei: '412000000000000',
    at: '2026-09-14T22:41:00.000Z',
  },
  {
    hash: '0x2b4d6f8a0c2e4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4a6c8e0b2d4f6a8c0e2b4d',
    userIdentifier: 'margaret@example.com',
    chain: 'Base',
    gasWei: '388000000000000',
    at: '2026-09-14T21:12:00.000Z',
  },
  {
    hash: '0x9e1c3f5a7d9b1e3c5f7a9d1b3e5c7f9a1d3b5e7c9f8f1c2a7d4b6e9c0f3a5d7b',
    userIdentifier: 'grace@gmail.com',
    chain: 'Arbitrum',
    gasWei: '96000000000000',
    at: '2026-09-14T18:30:00.000Z',
  },
  {
    hash: '0x6a8c0e2b4d6f8a0c2e4a6c8e0b2d4f6a8c0e2b4d2b4d6f8a0c2e4a6c8e0b2d4f',
    userIdentifier: 'linus@example.com',
    chain: 'Base',
    gasWei: '441000000000000',
    at: '2026-09-14T07:48:00.000Z',
  },
  {
    hash: '0x3c5f7a9d1b3e5c7f9a1d3b5e7c9f8f1c2a7d4b6e9c0f3a5d7b9e1c3f5a7d9b1e',
    userIdentifier: 'barbara@example.com',
    chain: 'Base',
    gasWei: '402000000000000',
    at: '2026-09-13T16:02:00.000Z',
  },
];

/* ---------- API keys ---------- */

export interface ApiKeySummary {
  id: ApiKeyId;
  /** First 12 characters, the only part the API keeps in clear. */
  prefix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const apiKeys: readonly ApiKeySummary[] = [
  {
    id: 'key_seed00000000000000000001' as ApiKeyId,
    prefix: 'pk_sk_seed00',
    name: 'Production server',
    createdAt: '2026-06-02T09:25:00.000Z',
    lastUsedAt: '2026-09-14T22:41:00.000Z',
  },
  {
    id: 'key_seed00000000000000000002' as ApiKeyId,
    prefix: 'pk_sk_seed01',
    name: 'CI',
    createdAt: '2026-07-11T16:02:00.000Z',
    lastUsedAt: null,
  },
];

/* ---------- Members ---------- */

export interface Member {
  email: string;
  role: 'owner' | 'admin' | 'viewer';
  joinedAt: string;
}

export const members: readonly Member[] = [
  { email: developer.email, role: 'owner', joinedAt: developer.createdAt },
];

/* ---------- End users ---------- */

export interface EndUserRow {
  id: EndUserId;
  identity: { type: LoginMethod; identifier: string };
  wallets: readonly { id: WalletId; chainFamily: 'evm' | 'solana'; address: string }[];
  activeSessions: number;
  createdAt: string;
  lastActiveAt: string | null;
}

const evmAddresses = [
  '0x3f2A9c1e5B7d4F6a8C0e2B4d6F8a0C2e4B6d8F0a',
  '0xA1b2C3d4E5f60718293A4b5C6d7E8f9A0b1C2d3E',
  '0x7E6d5C4b3A29181706F5e4D3c2B1a0F9e8D7c6B5',
  '0x0c9B8a7D6e5F4a3B2c1D0e9F8a7B6c5D4e3F2a1B',
  '0x5D4c3B2a1F0e9D8c7B6a5F4e3D2c1B0a9F8e7D6c',
  '0x9F8e7D6c5B4a3F2e1D0c9B8a7F6e5D4c3B2a1F0e',
  '0x2B1a0F9e8D7c6B5a4F3e2D1c0B9a8F7e6D5c4B3a',
  '0xC4b3A2f1E0d9C8b7A6f5E4d3C2b1A0f9E8d7C6b5',
];

const solanaAddresses = [
  '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCTfBi',
  'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy',
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
];

function wallet(id: number, family: 'evm' | 'solana', address: string) {
  return {
    id: `wlt_seed${id.toString().padStart(20, '0')}` as WalletId,
    chainFamily: family,
    address,
  };
}

export const endUsers: readonly EndUserRow[] = [
  {
    id: 'usr_seed00000000000000000001' as EndUserId,
    identity: { type: 'email', identifier: 'ada@example.com' },
    wallets: [
      wallet(1, 'evm', evmAddresses[0] ?? ''),
      wallet(2, 'solana', solanaAddresses[0] ?? ''),
    ],
    activeSessions: 2,
    createdAt: '2026-08-21T10:14:00.000Z',
    lastActiveAt: '2026-09-14T21:03:00.000Z',
  },
  {
    id: 'usr_seed00000000000000000002' as EndUserId,
    identity: { type: 'google', identifier: 'grace@gmail.com' },
    wallets: [wallet(3, 'evm', evmAddresses[1] ?? '')],
    activeSessions: 1,
    createdAt: '2026-08-23T08:40:00.000Z',
    lastActiveAt: '2026-09-14T18:30:00.000Z',
  },
  {
    id: 'usr_seed00000000000000000003' as EndUserId,
    identity: { type: 'passkey', identifier: 'passkey:3f9c...a1e2' },
    wallets: [
      wallet(4, 'evm', evmAddresses[2] ?? ''),
      wallet(5, 'solana', solanaAddresses[1] ?? ''),
    ],
    activeSessions: 0,
    createdAt: '2026-08-30T12:00:00.000Z',
    lastActiveAt: '2026-09-12T09:15:00.000Z',
  },
  {
    id: 'usr_seed00000000000000000004' as EndUserId,
    identity: { type: 'email', identifier: 'linus@example.com' },
    wallets: [wallet(6, 'evm', evmAddresses[3] ?? '')],
    activeSessions: 1,
    createdAt: '2026-09-02T15:22:00.000Z',
    lastActiveAt: '2026-09-14T07:48:00.000Z',
  },
  {
    id: 'usr_seed00000000000000000005' as EndUserId,
    identity: { type: 'wallet', identifier: evmAddresses[4] ?? '' },
    wallets: [wallet(7, 'evm', evmAddresses[4] ?? '')],
    activeSessions: 0,
    createdAt: '2026-09-04T19:05:00.000Z',
    lastActiveAt: '2026-09-10T11:20:00.000Z',
  },
  {
    id: 'usr_seed00000000000000000006' as EndUserId,
    identity: { type: 'email', identifier: 'margaret@example.com' },
    wallets: [
      wallet(8, 'evm', evmAddresses[5] ?? ''),
      wallet(9, 'solana', solanaAddresses[2] ?? ''),
    ],
    activeSessions: 3,
    createdAt: '2026-09-06T06:31:00.000Z',
    lastActiveAt: '2026-09-14T23:10:00.000Z',
  },
  {
    id: 'usr_seed00000000000000000007' as EndUserId,
    identity: { type: 'google', identifier: 'alan@gmail.com' },
    wallets: [wallet(10, 'evm', evmAddresses[6] ?? '')],
    activeSessions: 0,
    createdAt: '2026-09-09T13:44:00.000Z',
    lastActiveAt: null,
  },
  {
    id: 'usr_seed00000000000000000008' as EndUserId,
    identity: { type: 'email', identifier: 'barbara@example.com' },
    wallets: [wallet(11, 'evm', evmAddresses[7] ?? '')],
    activeSessions: 1,
    createdAt: '2026-09-13T17:58:00.000Z',
    lastActiveAt: '2026-09-14T16:02:00.000Z',
  },
];

/* ---------- Billing ---------- */

export interface Invoice {
  id: string;
  period: string;
  amountUsd: number;
  status: 'paid' | 'open';
  issuedAt: string;
}

export interface Billing {
  plan: 'usage-based';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Estimated charge for the current period, before Stripe finalizes it. */
  estimateUsd: number;
  lines: readonly { label: string; quantity: number; unit: string; amountUsd: number }[];
  paymentMethod: { brand: string; last4: string; exp: string } | null;
  invoices: readonly Invoice[];
}

export const billing: Billing = {
  plan: 'usage-based',
  currentPeriodStart: '2026-09-01T00:00:00.000Z',
  currentPeriodEnd: '2026-09-30T23:59:59.000Z',
  estimateUsd: 63.2,
  lines: [
    { label: 'Monthly active wallets', quantity: 5_201, unit: 'MAW', amountUsd: 52.01 },
    { label: 'Gas sponsored', quantity: 41, unit: 'USD', amountUsd: 4.1 },
    { label: 'Sessions signed', quantity: 7_090, unit: 'sessions', amountUsd: 7.09 },
  ],
  paymentMethod: { brand: 'Visa', last4: '4242', exp: '08/29' },
  invoices: [
    {
      id: 'in_0001',
      period: 'Aug 2026',
      amountUsd: 48.75,
      status: 'paid',
      issuedAt: '2026-09-01T00:10:00.000Z',
    },
    {
      id: 'in_0002',
      period: 'Jul 2026',
      amountUsd: 31.4,
      status: 'paid',
      issuedAt: '2026-08-01T00:10:00.000Z',
    },
    {
      id: 'in_0003',
      period: 'Jun 2026',
      amountUsd: 12.05,
      status: 'paid',
      issuedAt: '2026-07-01T00:10:00.000Z',
    },
  ],
};

/* ---------- Notifications ---------- */

export interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  completed: boolean;
}

/** Empty on purpose: the reference shows the "all caught up" state. */
export const notifications: readonly Notification[] = [];
