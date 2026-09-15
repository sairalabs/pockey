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
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: timestamp('created_at'),
  },
  (t) => [uniqueIndex('developers_email_idx').on(t.email)],
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
    createdAt: timestamp('created_at'),
    lastActiveAt: nullableTimestamp('last_active_at'),
  },
  (t) => [index('end_users_app_idx').on(t.appId)],
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

export type Developer = typeof developers.$inferSelect;
export type AppRow = typeof apps.$inferSelect;
export type NewAppRow = typeof apps.$inferInsert;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type EndUserRow = typeof endUsers.$inferSelect;
export type IdentityRow = typeof endUserIdentities.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type SessionSignerRow = typeof sessionSigners.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
export type UsageMonthlyRow = typeof usageMonthly.$inferSelect;
