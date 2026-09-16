import type { BetterAuthOptions, DBAdapter, DBTransactionAdapter, Where } from 'better-auth';

/**
 * Multi-tenancy for Better Auth (T1.1, section 4.2).
 *
 * Better Auth assumes one user pool. Pocketkey needs one pool per app: the same
 * email in two apps is two distinct end users. Rather than forking plugins, this
 * wraps the database adapter and rewrites every query at the boundary:
 *
 * - `user`: every read, update and delete gets `appId = <app>` appended as an AND
 *   clause, and every insert gets `appId` set. A user from another app is invisible.
 * - `verification`: identifiers (OTP keys, OAuth state, passkey challenges) are
 *   prefixed with the tenant scope, and the prefix is stripped on the way out.
 *   The scope includes the device id when present, which binds an OTP to the
 *   browser that requested it (section 8.1).
 *
 * Sessions, accounts and passkeys hang off a user id, which is already tenant
 * scoped, so they need no rewrite. The token exchange still re-checks `appId`.
 *
 * The Drizzle adapter groups AND clauses and OR clauses separately
 * (`and(and(...ands), or(...ors))`), so appending an AND clause is always safe.
 */

export interface TenantScope {
  appId: string;
  /** Optional extra binding for verification rows, e.g. a hashed device id. */
  verificationBinding?: string;
}

type AdapterFactory = (options: BetterAuthOptions) => DBAdapter;
type Row = Record<string, unknown>;

const USER = 'user';
const VERIFICATION = 'verification';

/** Better Auth email OTP identifiers look like `sign-in-otp-<email>`. */
const OTP_IDENTIFIER = /^[a-z-]+-otp-/;

export function scopeAdapter(factory: AdapterFactory, scope: TenantScope): AdapterFactory {
  // Device binding applies to OTP codes only. OAuth state and passkey challenges
  // are completed from a popup or a different request shape, so they stay app scoped.
  const prefixFor = (identifier: string) =>
    `${scope.appId}|${OTP_IDENTIFIER.test(identifier) ? (scope.verificationBinding ?? '-') : '-'}|`;
  const scopedPrefix = new RegExp(`^${scope.appId.replace(/[^A-Za-z0-9_]/g, '')}\\|[^|]*\\|`);

  const addPrefix = (value: Where['value']): Where['value'] => {
    if (typeof value === 'string') return prefixFor(value) + value;
    if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) {
      return value.map((v) => prefixFor(v) + v);
    }
    return value;
  };

  const scopeWhere = (model: string, where: Where[] | undefined): Where[] => {
    const clauses = where ?? [];
    if (model === USER) {
      return [...clauses, { field: 'appId', operator: 'eq', value: scope.appId, connector: 'AND' }];
    }
    if (model === VERIFICATION) {
      return clauses.map((clause) =>
        clause.field === 'identifier' ? { ...clause, value: addPrefix(clause.value) } : clause,
      );
    }
    return clauses;
  };

  const scopeData = (model: string, data: Row): Row => {
    if (model === USER) return { ...data, appId: scope.appId };
    if (model === VERIFICATION && typeof data.identifier === 'string') {
      return { ...data, identifier: prefixFor(data.identifier) + data.identifier };
    }
    return data;
  };

  const scopeUpdate = (model: string, update: Row): Row => {
    if (model === USER) {
      // A user can never be moved to another tenant.
      const { appId: _ignored, ...rest } = update;
      return rest;
    }
    return scopeData(model, update);
  };

  const unscopeRow = <T>(model: string, row: T): T => {
    if (model !== VERIFICATION || row === null || typeof row !== 'object') return row;
    const record = row as Row;
    if (typeof record.identifier === 'string' && scopedPrefix.test(record.identifier)) {
      return { ...record, identifier: record.identifier.replace(scopedPrefix, '') } as T;
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
