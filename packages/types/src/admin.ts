import { z } from 'zod';
import { App, AppConfig, CreateAppInput, UpdateAppInput } from './app.js';
import { ApiKeyId, AppId, DeveloperId, SecretApiKey } from './ids.js';
import { SponsorBalance } from './sponsoring.js';
import { UsageMonthly } from './usage.js';
import { EndUser } from './user.js';

/**
 * Dashboard API (`/admin/*`, spec section 7.2 and 10). Authenticated by a
 * developer session, never by an app id or a secret key. The dashboard calls
 * these through its own origin, which proxies to the API.
 */

export const Developer = z.object({
  id: DeveloperId,
  email: z.email(),
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** True once a Stripe customer exists, so the billing portal can open. */
  billingReady: z.boolean(),
});
export type Developer = z.infer<typeof Developer>;

/**
 * Which developer login methods this server can actually serve. Read before the
 * login screen renders, so the dashboard never offers a button that answers 400.
 */
export const AuthProviders = z.object({
  email: z.literal(true),
  github: z.boolean(),
});
export type AuthProviders = z.infer<typeof AuthProviders>;

export const AdminSession = z.object({ developer: Developer });
export type AdminSession = z.infer<typeof AdminSession>;

/** One row of `/admin/apps`, enough to render the list without extra calls. */
export const AdminApp = z.object({
  app: App,
  /** Current month, UTC. */
  usage: UsageMonthly,
  sponsorBalanceCents: z.number().int(),
  apiKeyCount: z.number().int().nonnegative(),
  endUserCount: z.number().int().nonnegative(),
});
export type AdminApp = z.infer<typeof AdminApp>;

export const AdminAppList = z.object({ apps: z.array(AdminApp) });
export type AdminAppList = z.infer<typeof AdminAppList>;

export { CreateAppInput, UpdateAppInput };

export const AdminAppConfigInput = z.object({ config: AppConfig });
export type AdminAppConfigInput = z.infer<typeof AdminAppConfigInput>;

/* API keys: the secret is returned once, at creation. */

export const ApiKeySummary = z.object({
  id: ApiKeyId,
  appId: AppId,
  /** First 12 characters, enough to recognize a key in a list. */
  prefix: z.string(),
  name: z.string().nullable(),
  scopes: z.array(z.string()),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiKeySummary = z.infer<typeof ApiKeySummary>;

export const ApiKeyList = z.object({ keys: z.array(ApiKeySummary) });
export type ApiKeyList = z.infer<typeof ApiKeyList>;

export const CreateApiKeyInput = z.object({ name: z.string().min(1).max(60).optional() });
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInput>;

export const CreateApiKeyOutput = z.object({
  key: ApiKeySummary,
  /** Shown once. Pockey only stores its hash. */
  secret: SecretApiKey,
});
export type CreateApiKeyOutput = z.infer<typeof CreateApiKeyOutput>;

/* Usage graphs */

export const UsageRange = z.enum(['7d', '30d', '12m']);
export type UsageRange = z.infer<typeof UsageRange>;

export const UsagePoint = z.object({
  /** `YYYY-MM-DD` for daily ranges, `YYYY-MM` for `12m`. */
  date: z.string(),
  activeUsers: z.number().int().nonnegative(),
  walletsCreated: z.number().int().nonnegative(),
  txSigned: z.number().int().nonnegative(),
  sessionSigned: z.number().int().nonnegative(),
  gasSponsoredWei: z.string().regex(/^\d+$/),
  gasSponsoredLamports: z.string().regex(/^\d+$/),
});
export type UsagePoint = z.infer<typeof UsagePoint>;

export const LoginMethodBreakdown = z.object({
  method: z.enum(['email', 'google', 'apple', 'passkey', 'wallet']),
  users: z.number().int().nonnegative(),
});

export const AdminUsage = z.object({
  range: UsageRange,
  points: z.array(UsagePoint),
  /** Current month totals, the numbers billing is based on. */
  month: UsageMonthly,
  loginMethods: z.array(LoginMethodBreakdown),
});
export type AdminUsage = z.infer<typeof AdminUsage>;

export const AdminEndUserList = z.object({
  users: z.array(EndUser),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type AdminEndUserList = z.infer<typeof AdminEndUserList>;

export { SponsorBalance };

/* Billing (spec section 11) */

export const FREE_MONTHLY_ACTIVE_WALLETS = 500;
export const PRICE_CENTS_PER_ACTIVE_WALLET = 6;

export const BillingSummary = z.object({
  plan: z.enum(['free', 'pay_as_you_go']),
  /** Monthly active wallets across every app of the developer, current month. */
  activeWallets: z.number().int().nonnegative(),
  includedWallets: z.number().int().nonnegative(),
  unitPriceCents: z.number().int().nonnegative(),
  /** What the current month would cost if it ended now. */
  estimatedCents: z.number().int().nonnegative(),
  /** Sum of the prepaid gas balances of every app. */
  sponsorBalanceCents: z.number().int(),
  portalAvailable: z.boolean(),
});
export type BillingSummary = z.infer<typeof BillingSummary>;

export const BillingPortalOutput = z.object({ url: z.url() });
export type BillingPortalOutput = z.infer<typeof BillingPortalOutput>;
