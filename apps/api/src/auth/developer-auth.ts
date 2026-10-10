import { authSchema, type Db } from '@pockey/db';
import { otpEmail, type Mailer } from '@pockey/mailer';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import type { BetterAuthOptions, DBAdapter, DBTransactionAdapter, Where } from 'better-auth';
import type { ParsedEnv } from '../env.js';

/**
 * Developer authentication for the dashboard (T5.1, spec section 10).
 *
 * A second Better Auth instance, separate from the end user one of
 * `better-auth.ts`. Both share the `ba_*` tables: end users carry an `app_id`,
 * developers carry `NULL`, and each instance filters on its own side so the two
 * pools can never see each other. Cookies are real cookies here: the dashboard
 * proxies `/admin/*` through its own origin, so there is no third party context
 * and no cookie bridge.
 */

/** Same OTP rules as end users (section 8.1): 6 digits, 10 minutes, 5 attempts. */
export const DEVELOPER_OTP_LENGTH = 6;
export const DEVELOPER_OTP_TTL_SECONDS = 10 * 60;
export const DEVELOPER_OTP_ATTEMPTS = 5;
/** A dashboard session is the real session, not a bridge, so it lasts a week. */
export const DEVELOPER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEVELOPER_AUTH_BASE_PATH = '/admin/auth';
export const DEVELOPER_APP_NAME = 'Pockey';
/** Distinct from the end user prefix, so a popup cookie never shadows a dashboard one. */
export const DEVELOPER_COOKIE_PREFIX = 'pockey_dev';

/* Adapter scoping */

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter;
type Row = Record<string, unknown>;

const USER = 'user';
const VERIFICATION = 'verification';
/** Prefix on verification identifiers, the developer equivalent of a tenant scope. */
const DEVELOPER_SCOPE = 'developer|';

/**
 * The developer counterpart of `scopeAdapter` (tenant-adapter.ts), deliberately
 * kept separate: that one scopes to one app, this one scopes to "no app".
 *
 * - `user`: every read, update and delete gets `appId IS NULL` appended (the
 *   Drizzle adapter turns a `null` value into `IS NULL`), and every insert writes
 *   `appId: null`. An end user of any app is invisible here, and the reverse
 *   holds through the tenant adapter.
 * - `verification`: OTP keys and OAuth state are prefixed, and the prefix is
 *   stripped on the way out, so a developer code can never be spent by an app.
 *
 * Sessions, accounts and passkeys hang off a user id, which is already scoped.
 */
export function developerScopeAdapter(factory: AdapterFactory): AdapterFactory {
  const addPrefix = (value: Where['value']): Where['value'] => {
    if (typeof value === 'string') return DEVELOPER_SCOPE + value;
    if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
      return value.map((item) => DEVELOPER_SCOPE + item);
    }
    return value;
  };

  const scopeWhere = (model: string, where: Where[] | undefined): Where[] => {
    const clauses = where ?? [];
    if (model === USER) {
      return [...clauses, { field: 'appId', operator: 'eq', value: null, connector: 'AND' }];
    }
    if (model === VERIFICATION) {
      return clauses.map((clause) =>
        clause.field === 'identifier' ? { ...clause, value: addPrefix(clause.value) } : clause,
      );
    }
    return clauses;
  };

  const scopeData = (model: string, data: Row): Row => {
    if (model === USER) return { ...data, appId: null };
    if (model === VERIFICATION && typeof data.identifier === 'string') {
      return { ...data, identifier: DEVELOPER_SCOPE + data.identifier };
    }
    return data;
  };

  const scopeUpdate = (model: string, update: Row): Row => {
    if (model === USER) {
      // A developer can never be moved into an app pool.
      const { appId: _ignored, ...rest } = update;
      return rest;
    }
    return scopeData(model, update);
  };

  const unscopeRow = <T>(model: string, row: T): T => {
    if (model !== VERIFICATION || row === null || typeof row !== 'object') return row;
    const record = row as Row;
    if (typeof record.identifier === 'string' && record.identifier.startsWith(DEVELOPER_SCOPE)) {
      return { ...record, identifier: record.identifier.slice(DEVELOPER_SCOPE.length) } as T;
    }
    return row;
  };

  const wrap = <A extends DBTransactionAdapter>(inner: A): A => ({
    ...inner,
    create: async (args) => {
      const created = await inner.create({
        ...args,
        data: scopeData(args.model, args.data as Row) as typeof args.data,
      });
      return unscopeRow(args.model, created);
    },
    findOne: async (args) =>
      unscopeRow(
        args.model,
        await inner.findOne({ ...args, where: scopeWhere(args.model, args.where) }),
      ),
    findMany: async (args) => {
      const rows = await inner.findMany({ ...args, where: scopeWhere(args.model, args.where) });
      return rows.map((row) => unscopeRow(args.model, row));
    },
    count: (args) => inner.count({ ...args, where: scopeWhere(args.model, args.where) }),
    update: async (args) =>
      unscopeRow(
        args.model,
        await inner.update({
          ...args,
          where: scopeWhere(args.model, args.where),
          update: scopeUpdate(args.model, args.update),
        }),
      ),
    updateMany: (args) =>
      inner.updateMany({
        ...args,
        where: scopeWhere(args.model, args.where),
        update: scopeUpdate(args.model, args.update),
      }),
    delete: (args) => inner.delete({ ...args, where: scopeWhere(args.model, args.where) }),
    deleteMany: (args) => inner.deleteMany({ ...args, where: scopeWhere(args.model, args.where) }),
    consumeOne: async (args) =>
      unscopeRow(
        args.model,
        await inner.consumeOne({ ...args, where: scopeWhere(args.model, args.where) }),
      ),
    incrementOne: async (args) =>
      unscopeRow(
        args.model,
        await inner.incrementOne({
          ...args,
          where: scopeWhere(args.model, args.where),
          ...(args.set ? { set: scopeUpdate(args.model, args.set) } : {}),
        }),
      ),
  });

  return (options) => {
    const inner = factory(options);
    const wrapped = wrap(inner);
    return {
      ...wrapped,
      transaction: (callback) => inner.transaction((trx) => callback(wrap(trx))),
    };
  };
}

/* Instance */

export interface DeveloperAuthInput {
  db: Db;
  config: ParsedEnv;
  mailer: Mailer;
}

/** True when GitHub sign-in is configured. Without both secrets it stays off. */
export function githubConfigured(config: ParsedEnv): boolean {
  return Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
}

/**
 * One instance per request, like the end user one: construction is cheap and
 * carries no I/O.
 */
export function createDeveloperAuth(input: DeveloperAuthInput) {
  const { config, mailer } = input;
  const apiOrigin = new URL(config.API_BASE_URL).origin;
  // Cookies must not be Secure on a plain http development origin, or the
  // browser drops them and the dashboard never keeps a session.
  const secure = new URL(config.API_BASE_URL).protocol === 'https:';
  const github =
    config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
      ? {
          clientId: config.GITHUB_CLIENT_ID,
          clientSecret: config.GITHUB_CLIENT_SECRET,
          // The dashboard proxies /admin/auth under its own origin, so the OAuth
          // state cookie lives there. GitHub must come back to the proxy, not to
          // the API, or that cookie is not sent and the flow cannot close.
          redirectURI: `${config.DASHBOARD_ORIGIN}/api/admin/auth/callback/github`,
        }
      : undefined;

  return betterAuth({
    appName: DEVELOPER_APP_NAME,
    baseURL: config.API_BASE_URL,
    basePath: DEVELOPER_AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    database: developerScopeAdapter(
      drizzleAdapter(input.db, { provider: 'sqlite', schema: authSchema }),
    ),
    user: {
      additionalFields: {
        appId: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: DEVELOPER_SESSION_TTL_SECONDS,
      cookieCache: { enabled: false },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ['github', 'email-otp'] },
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(github ? { github } : {}),
    },
    trustedOrigins: [config.DASHBOARD_ORIGIN, apiOrigin],
    // Rate limiting is T5.5 (per app and per developer, KV or Durable Objects).
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: DEVELOPER_COOKIE_PREFIX,
      useSecureCookies: secure,
      // The dashboard proxies the API under its own origin, so Lax is enough.
      defaultCookieAttributes: { sameSite: 'lax', secure },
    },
    plugins: [
      emailOTP({
        otpLength: DEVELOPER_OTP_LENGTH,
        expiresIn: DEVELOPER_OTP_TTL_SECONDS,
        allowedAttempts: DEVELOPER_OTP_ATTEMPTS,
        storeOTP: 'hashed',
        sendVerificationOTP: async ({ email, otp }) => {
          await mailer.send(
            otpEmail({
              to: email,
              code: otp,
              appName: DEVELOPER_APP_NAME,
              minutes: DEVELOPER_OTP_TTL_SECONDS / 60,
            }),
          );
        },
      }),
    ],
  });
}

export type DeveloperAuth = ReturnType<typeof createDeveloperAuth>;
