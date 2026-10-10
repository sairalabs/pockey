import { endUsers, type AppRow, type Db, type EndUserRow } from '@pockey/db';
import { KeyProviderError, type CreateSubOrganizationOutput } from '@pockey/key-provider';
import { KeySession } from '@pockey/types';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../errors.js';
import { providerFailure } from './provider-failure.js';

/**
 * Link between an end user and their sub-organization at the key provider
 * (non-custodial, DECISIONS.md 2026-09-19). The sub-organization is created at
 * sign-up with the end user as its only root; Pockey keeps its ids.
 */

export async function loadEndUserRow(db: Db, app: AppRow, endUserId: string): Promise<EndUserRow> {
  const user = await db.query.endUsers.findFirst({
    where: and(eq(endUsers.id, endUserId), eq(endUsers.appId, app.id)),
  });
  if (!user) throw new ApiError('not_found', 'End user not found');
  return user;
}

/** Stores the sub-organization of a new end user. Refuses to replace an existing one. */
export async function attachSubOrganization(
  db: Db,
  endUserId: string,
  created: CreateSubOrganizationOutput,
): Promise<void> {
  const [row] = await db
    .update(endUsers)
    .set({
      keyProviderSubOrgId: created.subOrgId,
      keyProviderUserId: created.rootUserId,
      keyProviderAccounts: created.accounts,
    })
    .where(and(eq(endUsers.id, endUserId), isNull(endUsers.keyProviderSubOrgId)))
    .returning({ id: endUsers.id });
  if (!row) {
    // A concurrent sign-up of the same identity won: its sub-organization stays,
    // this one is orphaned at the provider and holds no funds.
    throw new ApiError('conflict', 'This account was created by another request, sign in again');
  }
}

/** The end user owning a sub-organization, within this app only. */
export async function endUserBySubOrg(
  db: Db,
  app: AppRow,
  subOrgId: string,
): Promise<EndUserRow | undefined> {
  return db.query.endUsers.findFirst({
    where: and(eq(endUsers.keyProviderSubOrgId, subOrgId), eq(endUsers.appId, app.id)),
  });
}

export function keySessionOf(user: EndUserRow): KeySession | null {
  if (!user.keyProviderSubOrgId || !user.keyProviderUserId || !user.keyProviderAccounts) {
    return null;
  }
  return KeySession.parse({
    organizationId: user.keyProviderSubOrgId,
    userId: user.keyProviderUserId,
    signerUserId: user.keyProviderSignerUserId,
    accounts: user.keyProviderAccounts,
  });
}

export function requireKeySession(user: EndUserRow): KeySession {
  const session = keySessionOf(user);
  if (!session) throw new ApiError('internal', 'This user has no key provider sub-organization');
  return session;
}

/**
 * Key provider failures of a request the end user stamped. A refused or stale
 * credential means the iframe session key is gone: the user must sign in again.
 */
export function relayFailure(error: unknown): never {
  if (error instanceof KeyProviderError) {
    switch (error.code) {
      case 'unexpected_request':
        throw new ApiError('bad_request', 'The signed request does not match this operation', {
          reason: 'unexpected_request',
        });
      case 'unauthenticated':
        throw new ApiError('unauthorized', 'The wallet session expired, sign in again', {
          reason: 'key_session_expired',
        });
      case 'policy_denied':
        throw new ApiError('forbidden', 'The key provider refused this request', {
          reason: 'provider_denied',
        });
      default:
        break;
    }
  }
  return providerFailure(error);
}
