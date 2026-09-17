import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AppConfig, SigningPolicy } from '@pocketkey/types';

/* Helpers */

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

const nullableTimestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

/* Section 9: Pocketkey tables */

export const developers = sqliteTable(
  'developers',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    /**
     * Better Auth user behind the dashboard login (T5.1). Null until the first
     * sign-in, so rows created by the seed or by support stay valid.
     */
    authUserId: text('auth_user_id'),
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    uniqueIndex('developers_email_idx').on(t.email),
    uniqueIndex('developers_auth_user_idx').on(t.authUserId),
  ],
);

export const apps = sqliteTable(
  'apps',
  {
    id: text('id').primaryKey(),
    /** `pk_app_...`, the id the SDK sends in `X-Pocketkey-App-Id`. */
    publicId: text('public_id').notNull(),
    developerId: text('developer_id')
      .notNull()
      .references(() => developers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    allowedOrigins: json<string[]>('allowed_origins').notNull().default([]),
    config: json<AppConfig>('config').notNull(),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    uniqueIndex('apps_public_id_idx').on(t.publicId),
    uniqueIndex('apps_developer_slug_idx').on(t.developerId, t.slug),
  ],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the full secret. */
    hash: text('hash').notNull(),
    /** First 12 chars (`pk_sk_abcdef`) for display in the dashboard. */
    prefix: text('prefix').notNull(),
    name: text('name'),
    scopes: json<string[]>('scopes').notNull().default(['server']),
    lastUsedAt: nullableTimestamp('last_used_at'),
    revokedAt: nullableTimestamp('revoked_at'),
    createdAt: timestamp('created_at'),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.hash), index('api_keys_app_idx').on(t.appId)],
);

export const endUsers = sqliteTable(
  'end_users',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    /** Sub-organization at the key provider. Null until the first wallet is created. */
    keyProviderSubOrgId: text('key_provider_sub_org_id'),
    /**
     * Better Auth user behind email, OAuth and passkey logins. Null for users
     * who only ever signed in with an external wallet (SIWE / SIWS).
     */
    authUserId: text('auth_user_id'),
    createdAt: timestamp('created_at'),
    lastActiveAt: nullableTimestamp('last_active_at'),
  },
  (t) => [
    index('end_users_app_idx').on(t.appId),
    uniqueIndex('end_users_auth_user_idx').on(t.authUserId),
  ],
);

/**
 * Refresh tokens (T1.4). Opaque, stored as SHA-256. Each use rotates the token
 * inside the same family; presenting an already rotated token revokes the
 * whole family (reuse detection).
 */
export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    endUserId: text('end_user_id')
      .notNull()
      .references(() => endUsers.id, { onDelete: 'cascade' }),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    familyId: text('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    rotatedAt: nullableTimestamp('rotated_at'),
    revokedAt: nullableTimestamp('revoked_at'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_idx').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.endUserId),
  ],
);

/**
 * Single-use, short-lived values (section 8.1 replay protection).
 * - `siwe` / `siws`: login nonces, id = the nonce itself (public by design).
 * - `oauth_state`: maps a provider state to the app that started the flow,
 *   id = SHA-256 of the state, so the callback can find its tenant.
 * - `exchange_code`: handed from the OAuth popup to the iframe, id = SHA-256 of
 *   the code, `subject` = Better Auth user id.
 * Consumption is a conditional UPDATE on `consumed_at IS NULL`, so it is atomic.
 */
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['siwe', 'siws', 'oauth_state', 'exchange_code'] }).notNull(),
    subject: text('subject'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: nullableTimestamp('consumed_at'),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('auth_challenges_app_idx').on(t.appId)],
);

export const endUserIdentities = sqliteTable(
  'end_user_identities',
  {
    id: text('id').primaryKey(),
    endUserId: text('end_user_id')
      .notNull()
      .references(() => endUsers.id, { onDelete: 'cascade' }),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['email', 'google', 'apple', 'passkey', 'wallet'] }).notNull(),
    identifier: text('identifier').notNull(),
    verifiedAt: nullableTimestamp('verified_at'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    // Same email in two apps = two end users (section 4.2), so uniqueness is per app.
    uniqueIndex('identities_app_type_identifier_idx').on(t.appId, t.type, t.identifier),
    index('identities_end_user_idx').on(t.endUserId),
  ],
);

export const wallets = sqliteTable(
  'wallets',
  {
    id: text('id').primaryKey(),
    endUserId: text('end_user_id')
      .notNull()
      .references(() => endUsers.id, { onDelete: 'cascade' }),
    chainFamily: text('chain_family', { enum: ['evm', 'solana'] }).notNull(),
    address: text('address').notNull(),
    keyProviderWalletId: text('key_provider_wallet_id').notNull(),
    smartAccountAddress: text('smart_account_address'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    // One wallet per chain family per user at MVP (section 4.2).
    uniqueIndex('wallets_user_family_idx').on(t.endUserId, t.chainFamily),
    index('wallets_address_idx').on(t.address),
  ],
);

export const sessionSigners = sqliteTable(
  'session_signers',
  {
    id: text('id').primaryKey(),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    keyProviderPolicyId: text('key_provider_policy_id').notNull(),
    policy: json<SigningPolicy>('policy').notNull(),
    /** Decimal string, smallest unit. Mirrors `maxValueTotal` enforcement. */
    spentTotal: text('spent_total').notNull().default('0'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: nullableTimestamp('revoked_at'),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('session_signers_wallet_idx').on(t.walletId)],
);

export const usageEvents = sqliteTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    endUserId: text('end_user_id'),
    type: text('type', {
      enum: ['wallet.created', 'user.active', 'tx.signed', 'tx.sponsored', 'session.signed'],
    }).notNull(),
    /** Gas amount for `tx.sponsored`, decimal string in smallest unit. */
    amount: text('amount'),
    meta: json<Record<string, unknown>>('meta'),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('usage_events_app_created_idx').on(t.appId, t.createdAt)],
);

export const usageMonthly = sqliteTable(
  'usage_monthly',
  {
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    /** `YYYY-MM` UTC. */
    month: text('month').notNull(),
    activeUsers: integer('active_users').notNull().default(0),
    walletsCreated: integer('wallets_created').notNull().default(0),
    txSigned: integer('tx_signed').notNull().default(0),
    sessionSigned: integer('session_signed').notNull().default(0),
    gasSponsoredWei: text('gas_sponsored_wei').notNull().default('0'),
    gasSponsoredLamports: text('gas_sponsored_lamports').notNull().default('0'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [primaryKey({ columns: [t.appId, t.month] })],
);

export const sponsorBalances = sqliteTable('sponsor_balances', {
  appId: text('app_id')
    .primaryKey()
    .references(() => apps.id, { onDelete: 'cascade' }),
  balanceCents: integer('balance_cents').notNull().default(0),
  updatedAt: timestamp('updated_at'),
});

/**
 * Append-only audit of every balance movement (T4.6). `balance_cents` above is
 * the fast path; this ledger explains it. Top-ups are positive, charges negative.
 * `reference` is unique so a replayed webhook or a retried charge cannot count twice.
 */
export const sponsorLedger = sqliteTable(
  'sponsor_ledger',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['topup', 'charge', 'refund'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    reference: text('reference').notNull(),
    meta: json<Record<string, unknown>>('meta'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    uniqueIndex('sponsor_ledger_reference_idx').on(t.reference),
    index('sponsor_ledger_app_idx').on(t.appId, t.createdAt),
  ],
);

/**
 * Wallets Pocketkey owns on behalf of an app (section 7.5): the Solana fee payer
 * lives in a system sub-organization at the key provider, one per app.
 */
export const appSystemWallets = sqliteTable(
  'app_system_wallets',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['solana_fee_payer'] }).notNull(),
    keyProviderSubOrgId: text('key_provider_sub_org_id').notNull(),
    keyProviderWalletId: text('key_provider_wallet_id').notNull(),
    address: text('address').notNull(),
    createdAt: timestamp('created_at'),
  },
  (t) => [uniqueIndex('app_system_wallets_purpose_idx').on(t.appId, t.purpose)],
);

/** Processed payment provider events, so webhook retries are idempotent. */
export const paymentEvents = sqliteTable('payment_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at'),
});

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    appId: text('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: json<string[]>('events').notNull().default([]),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('webhooks_app_idx').on(t.appId)],
);

/* Better Auth tables, prefixed `ba_` (section 9). Shape follows the Better Auth
   core schema plus the passkey plugin. `ba_user` doubles as the developer login
   for the dashboard and as the end-user login for apps; `app_id` scopes the latter. */

export const baUser = sqliteTable(
  'ba_user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    /** Null for developers, set for end users (multi-tenant, T1.1). */
    appId: text('app_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [uniqueIndex('ba_user_app_email_idx').on(t.appId, t.email)],
);

export const baSession = sqliteTable(
  'ba_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => baUser.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    uniqueIndex('ba_session_token_idx').on(t.token),
    index('ba_session_user_idx').on(t.userId),
  ],
);

export const baAccount = sqliteTable(
  'ba_account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => baUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: nullableTimestamp('access_token_expires_at'),
    refreshTokenExpiresAt: nullableTimestamp('refresh_token_expires_at'),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [index('ba_account_user_idx').on(t.userId)],
);

export const baVerification = sqliteTable(
  'ba_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [index('ba_verification_identifier_idx').on(t.identifier)],
);

export const baPasskey = sqliteTable(
  'ba_passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => baUser.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull().default(0),
    deviceType: text('device_type').notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' }).notNull().default(false),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    uniqueIndex('ba_passkey_credential_idx').on(t.credentialID),
    index('ba_passkey_user_idx').on(t.userId),
  ],
);

/** Map handed to Better Auth's drizzle adapter (`schema` option) in T1.1. */
export const authSchema = {
  user: baUser,
  session: baSession,
  account: baAccount,
  verification: baVerification,
  passkey: baPasskey,
};

export type DeveloperRow = typeof developers.$inferSelect;
export type Developer = DeveloperRow;
export type AppRow = typeof apps.$inferSelect;
export type NewAppRow = typeof apps.$inferInsert;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type EndUserRow = typeof endUsers.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type AuthChallengeRow = typeof authChallenges.$inferSelect;
export type IdentityRow = typeof endUserIdentities.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type SessionSignerRow = typeof sessionSigners.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
export type UsageMonthlyRow = typeof usageMonthly.$inferSelect;
export type SponsorLedgerRow = typeof sponsorLedger.$inferSelect;
export type AppSystemWalletRow = typeof appSystemWallets.$inferSelect;
