import { z } from 'zod';

/**
 * Every identifier in Pocketkey is a prefixed cuid2: `<prefix>_<cuid2>`.
 * The prefix makes ids self-describing in logs and support tickets.
 */
export const ID_PREFIXES = {
  developer: 'dev',
  app: 'app',
  apiKey: 'key',
  endUser: 'usr',
  identity: 'idn',
  wallet: 'wlt',
  sessionSigner: 'ses',
  usageEvent: 'evt',
  webhook: 'whk',
  refreshToken: 'rtk',
  ledgerEntry: 'led',
  systemWallet: 'swl',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

const CUID2 = /^[a-z][a-z0-9]{23}$/;

function prefixedId<P extends string>(prefix: P) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_[a-z][a-z0-9]{23}$`), `Expected an id prefixed with "${prefix}_"`)
    .brand<`${P}Id`>();
}

export const DeveloperId = prefixedId(ID_PREFIXES.developer);
export const AppId = prefixedId(ID_PREFIXES.app);
export const ApiKeyId = prefixedId(ID_PREFIXES.apiKey);
export const EndUserId = prefixedId(ID_PREFIXES.endUser);
export const IdentityId = prefixedId(ID_PREFIXES.identity);
export const WalletId = prefixedId(ID_PREFIXES.wallet);
export const SessionSignerId = prefixedId(ID_PREFIXES.sessionSigner);
export const UsageEventId = prefixedId(ID_PREFIXES.usageEvent);
export const WebhookId = prefixedId(ID_PREFIXES.webhook);

export type DeveloperId = z.infer<typeof DeveloperId>;
export type AppId = z.infer<typeof AppId>;
export type ApiKeyId = z.infer<typeof ApiKeyId>;
export type EndUserId = z.infer<typeof EndUserId>;
export type IdentityId = z.infer<typeof IdentityId>;
export type WalletId = z.infer<typeof WalletId>;
export type SessionSignerId = z.infer<typeof SessionSignerId>;
export type UsageEventId = z.infer<typeof UsageEventId>;
export type WebhookId = z.infer<typeof WebhookId>;

/**
 * Public app identifier handed to the SDK: `pk_app_<cuid2>`.
 * Safe to ship in client bundles.
 */
export const PublicAppId = z
  .string()
  .regex(/^pk_app_[a-z][a-z0-9]{23}$/, 'Expected a public app id like "pk_app_..."')
  .brand<'PublicAppId'>();
export type PublicAppId = z.infer<typeof PublicAppId>;

/**
 * Secret server-side key: `pk_sk_<cuid2>`. Never ships to a browser.
 * The API stores only its SHA-256 hash and the first 12 characters for display.
 */
export const SecretApiKey = z
  .string()
  .regex(/^pk_sk_[a-z][a-z0-9]{23}$/, 'Expected a secret key like "pk_sk_..."')
  .brand<'SecretApiKey'>();
export type SecretApiKey = z.infer<typeof SecretApiKey>;

export const isCuid2 = (value: string): boolean => CUID2.test(value);
