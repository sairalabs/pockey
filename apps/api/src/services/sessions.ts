import {
  prepareTransaction,
  serializeUnsignedTransaction,
  signatureToHex,
  signPersonalMessage,
  signTypedDataInput,
  type SignHash,
} from '@pocketkey/chains-evm';
import {
  decodeTransaction,
  inspectTransaction,
  signMessage as signSolanaMessage,
  transactionId,
  type InspectedTransaction,
  type SignBytes,
} from '@pocketkey/chains-solana';
import {
  endUsers,
  newId,
  sessionSigners,
  usageEvents,
  wallets,
  type Db,
  type SessionSignerRow,
  type WalletRow,
} from '@pocketkey/db';
import { KeyProviderError, type KeyProvider } from '@pocketkey/key-provider';
import {
  AppConfig,
  durationToSeconds,
  SessionSigner,
  type CreateSessionInput,
  type SessionSignOutput,
  type SessionSignRequest,
} from '@pocketkey/types';
import { base64 } from '@scure/base';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { hexToBytes, type Address, type Hex } from 'viem';
import { ApiError } from '../errors.js';
import {
  checkSessionRequest,
  checkSessionState,
  VIOLATION_MESSAGES,
  type PolicyCheck,
  type PolicyContext,
} from './policy.js';
import { assertSponsoringEnabled, sendSponsored } from './sponsored-send.js';
import { loadOwnedWallet, providerFailure, requireSponsor, type WalletDeps } from './wallets.js';

/**
 * Session signers (T4.2, section 7.4). A session is a key provider policy bound
 * to one wallet, mirrored in `session_signers`. Pocketkey checks every request
 * locally first, reserves `maxValueTotal` atomically, then signs through the key
 * provider with the policy id so the provider re-checks what it can.
 */

export type SessionDeps = WalletDeps;

const RESERVE_ATTEMPTS = 3;

export function toSessionSigner(row: SessionSignerRow): SessionSigner {
  return SessionSigner.parse({
    id: row.id,
    walletId: row.walletId,
    policy: row.policy,
    spentTotal: row.spentTotal,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

function assertAllowed(check: PolicyCheck): bigint {
  if (!check.ok) {
    throw new ApiError('policy_violation', VIOLATION_MESSAGES[check.reason], {
      reason: check.reason,
    });
  }
  return check.value;
}

/** The provider refusing under a session policy is a policy violation, not an outage. */
function sessionProviderFailure(error: unknown): never {
  if (error instanceof KeyProviderError && error.code === 'policy_denied') {
    throw new ApiError(
      'policy_violation',
      'The key provider refused this request under the session policy',
      { reason: 'provider_denied' },
    );
  }
  return providerFailure(error);
}

async function subOrgOf(db: Db, endUserId: string, appId: string): Promise<string> {
  const user = await db.query.endUsers.findFirst({
    where: and(eq(endUsers.id, endUserId), eq(endUsers.appId, appId)),
  });
  if (!user) throw new ApiError('not_found', 'Session not found');
  if (!user.keyProviderSubOrgId) {
    throw new ApiError('internal', 'Wallet has no key provider sub-organization');
  }
  return user.keyProviderSubOrgId;
}

/* Create, list, revoke */

export async function createSession(
  deps: SessionDeps,
  endUserId: string,
  input: CreateSessionInput,
  now = new Date(),
): Promise<SessionSignerRow> {
  const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, input.walletId);
  const { policy } = input;

  if (policy.chain !== wallet.chainFamily) {
    throw new ApiError(
      'validation_failed',
      `This is a ${wallet.chainFamily} wallet, the policy targets ${policy.chain}`,
    );
  }
  if (policy.chain === 'solana' && (policy.allowedChains || policy.allowedContracts)) {
    throw new ApiError(
      'validation_failed',
      'allowedChains and allowedContracts only apply to EVM sessions',
    );
  }
  if (policy.chain === 'evm' && policy.allowedPrograms) {
    throw new ApiError('validation_failed', 'allowedPrograms only applies to Solana sessions');
  }
  if (policy.allowedChains) {
    const enabled = AppConfig.parse(deps.app.config).chains.evm;
    const disabled = policy.allowedChains.filter((chainId) => !enabled.includes(chainId));
    if (disabled.length > 0) {
      throw new ApiError(
        'validation_failed',
        `Chains not enabled for this app: ${disabled.join(', ')}`,
      );
    }
  }

  const expiresAt = new Date(now.getTime() + durationToSeconds(policy.expiresIn) * 1000);
  const { policyId } = await deps.keyProvider
    .createPolicy({ subOrgId, walletId: wallet.keyProviderWalletId, policy, expiresAt })
    .catch(providerFailure);

  try {
    const [row] = await deps.db
      .insert(sessionSigners)
      .values({
        id: newId('ses'),
        walletId: wallet.id,
        keyProviderPolicyId: policyId,
        policy,
        expiresAt,
        createdAt: now,
      })
      .returning();
    if (!row) throw new ApiError('internal', 'Could not store the session');
    return row;
  } catch (error) {
    // Never leave a live provider policy without its mirror row.
    await deps.keyProvider.deletePolicy({ subOrgId, policyId }).catch(() => undefined);
    throw error;
  }
}

/** Every session of the user's wallets, newest first, whatever their state. */
export async function listSessions(
  deps: SessionDeps,
  endUserId: string,
): Promise<SessionSignerRow[]> {
  const rows = await deps.db
    .select({ session: sessionSigners })
    .from(sessionSigners)
    .innerJoin(wallets, eq(wallets.id, sessionSigners.walletId))
    .where(eq(wallets.endUserId, endUserId))
    .orderBy(desc(sessionSigners.createdAt), desc(sessionSigners.id));
  return rows.map((row) => row.session);
}

/** A session of this user. Someone else's session and a missing one are both 404. */
export async function loadUserSession(
  deps: SessionDeps,
  endUserId: string,
  sessionId: string,
): Promise<SessionSignerRow> {
  const [row] = await deps.db
    .select({ session: sessionSigners })
    .from(sessionSigners)
    .innerJoin(wallets, eq(wallets.id, sessionSigners.walletId))
    .where(and(eq(sessionSigners.id, sessionId), eq(wallets.endUserId, endUserId)))
    .limit(1);
  if (!row) throw new ApiError('not_found', 'Session not found');
  return row.session;
}

/**
 * Idempotent. The DB flag lands first so the API refuses the session at once,
 * then the provider policy is deleted; a policy already gone is fine, and a
 * provider failure surfaces so the caller can retry (each retry deletes again).
 */
export async function revokeSession(
  deps: SessionDeps,
  endUserId: string,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  const session = await loadUserSession(deps, endUserId, sessionId);
  await deps.db
    .update(sessionSigners)
    .set({ revokedAt: now })
    .where(and(eq(sessionSigners.id, session.id), isNull(sessionSigners.revokedAt)));

  const subOrgId = await subOrgOf(deps.db, endUserId, deps.app.id);
  await deps.keyProvider
    .deletePolicy({ subOrgId, policyId: session.keyProviderPolicyId })
    .catch((error: unknown) => {
      if (error instanceof KeyProviderError && error.code === 'not_found') return;
      providerFailure(error);
    });
}

/* Spending reservation (maxValueTotal) */

/**
 * Compare-and-set on `spent_total`: the value is reserved before signing, so two
 * concurrent requests can never both fit under the cap. Decimal strings, BigInt math.
 */
async function reserve(db: Db, session: SessionSignerRow, value: bigint): Promise<void> {
  const cap = session.policy.maxValueTotal;
  for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
    const current = await db.query.sessionSigners.findFirst({
      where: eq(sessionSigners.id, session.id),
    });
    if (!current) throw new ApiError('not_found', 'Session not found');
    if (current.revokedAt !== null) assertAllowed({ ok: false, reason: 'session_revoked' });
    const next = BigInt(current.spentTotal) + value;
    if (cap !== undefined && next > BigInt(cap)) {
      assertAllowed({ ok: false, reason: 'value_total_exceeded' });
    }
    const updated = await db
      .update(sessionSigners)
      .set({ spentTotal: next.toString() })
      .where(
        and(
          eq(sessionSigners.id, session.id),
          eq(sessionSigners.spentTotal, current.spentTotal),
          isNull(sessionSigners.revokedAt),
        ),
      )
      .returning({ id: sessionSigners.id });
    if (updated.length > 0) return;
  }
  throw new ApiError('conflict', 'This session is being used concurrently, retry the request');
}

/** Best effort compensation after a failed signature or broadcast. */
async function release(db: Db, sessionId: string, value: bigint): Promise<void> {
  try {
    for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
      const current = await db.query.sessionSigners.findFirst({
        where: eq(sessionSigners.id, sessionId),
      });
      if (!current) return;
      const spent = BigInt(current.spentTotal);
      const next = spent > value ? spent - value : 0n;
      const updated = await db
        .update(sessionSigners)
        .set({ spentTotal: next.toString() })
        .where(
          and(eq(sessionSigners.id, sessionId), eq(sessionSigners.spentTotal, current.spentTotal)),
        )
        .returning({ id: sessionSigners.id });
      if (updated.length > 0) return;
    }
    console.error(`[sessions] could not release ${value.toString()} on ${sessionId}`);
  } catch (error) {
    console.error(`[sessions] release failed on ${sessionId}`, error);
  }
}

/* Signing */

export interface SignWithSessionOptions {
  /** Who asked: the end user (`/v1/sessions`) or the developer backend (`/v1/server`). */
  via: 'user' | 'server';
  now?: Date;
}

function evmSessionSigner(
  deps: SessionDeps,
  subOrgId: string,
  wallet: WalletRow,
  sessionPolicyId: string,
): SignHash {
  return async (hash) => {
    const { signature } = await deps.keyProvider
      .signRaw({
        subOrgId,
        walletId: wallet.keyProviderWalletId,
        payload: hexToBytes(hash),
        encoding: 'hash',
        sessionPolicyId,
      })
      .catch(sessionProviderFailure);
    return signatureToHex(signature);
  };
}

function solanaSessionSigner(
  deps: SessionDeps,
  subOrgId: string,
  wallet: WalletRow,
  sessionPolicyId: string,
): SignBytes {
  return async (bytes) => {
    const { signature } = await deps.keyProvider
      .signRaw({
        subOrgId,
        walletId: wallet.keyProviderWalletId,
        payload: bytes,
        encoding: 'raw',
        sessionPolicyId,
      })
      .catch(sessionProviderFailure);
    return signature;
  };
}

async function recordSessionSigned(
  deps: SessionDeps,
  endUserId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await deps.db.insert(usageEvents).values({
    id: newId('evt'),
    appId: deps.app.id,
    endUserId,
    type: 'session.signed',
    meta,
  });
}

function inspectSolana(transaction: string, walletAddress: string): InspectedTransaction {
  let inspected: InspectedTransaction;
  try {
    inspected = inspectTransaction(transaction);
  } catch (error) {
    throw new ApiError(
      'bad_request',
      error instanceof Error ? error.message : 'Invalid Solana transaction',
    );
  }
  const signers = inspected.staticAccountKeys.slice(0, inspected.numRequiredSignatures);
  if (!signers.includes(walletAddress)) {
    throw new ApiError(
      'bad_request',
      `${walletAddress} is not a required signer of this transaction`,
    );
  }
  return inspected;
}

export async function signWithSession(
  deps: SessionDeps,
  session: SessionSignerRow,
  request: SessionSignRequest,
  options: SignWithSessionOptions,
): Promise<SessionSignOutput> {
  const now = options.now ?? new Date();
  const wallet = await deps.db.query.wallets.findFirst({
    where: eq(wallets.id, session.walletId),
  });
  if (!wallet) throw new ApiError('not_found', 'Session not found');
  const subOrgId = await subOrgOf(deps.db, wallet.endUserId, deps.app.id);

  assertAllowed(checkSessionState(session, now));
  if (request.kind === 'transaction' && request.sponsored) {
    if (!request.broadcast) {
      throw new ApiError('bad_request', 'Sponsored transactions are always broadcast');
    }
    assertSponsoringEnabled(deps.app, request.input.chain);
  }

  const context: PolicyContext = {
    now,
    wallet: { id: wallet.id, chainFamily: wallet.chainFamily, address: wallet.address },
    enabledChains: AppConfig.parse(deps.app.config).chains,
  };
  const sessionPolicyId = session.keyProviderPolicyId;
  const meta = { sessionId: session.id, kind: request.kind, via: options.via };

  if (request.kind === 'message') {
    assertAllowed(checkSessionRequest(session, request, context));
    const { input } = request;
    const signature =
      input.chain === 'evm'
        ? await signPersonalMessage(
            typeof input.message === 'string' ? input.message : { raw: input.message.raw as Hex },
            evmSessionSigner(deps, subOrgId, wallet, sessionPolicyId),
          )
        : await signSolanaMessage(
            input.message,
            solanaSessionSigner(deps, subOrgId, wallet, sessionPolicyId),
          );
    await recordSessionSigned(deps, wallet.endUserId, { ...meta, chain: input.chain });
    return { signature, sponsored: false };
  }

  if (request.kind === 'typedData') {
    assertAllowed(checkSessionRequest(session, request, context));
    const signature = await signTypedDataInput(
      request.input,
      evmSessionSigner(deps, subOrgId, wallet, sessionPolicyId),
    );
    await recordSessionSigned(deps, wallet.endUserId, { ...meta, chain: 'evm' });
    return { signature, sponsored: false };
  }

  const { input, broadcast } = request;
  if (request.sponsored) {
    return signSponsoredWithSession(deps, session, request, { wallet, subOrgId, context, meta });
  }
  let unsignedTransaction: string;
  let value: bigint;

  if (input.chain === 'evm') {
    // Fail fast on the request values before any RPC call; preparation only fills
    // nonce, gas and fees, so chain, destination and value do not change.
    value = assertAllowed(
      checkSessionRequest(session, request, {
        ...context,
        evmTransaction: { chainId: input.chainId, to: input.to, value: BigInt(input.value) },
      }),
    );
    try {
      const prepared = await prepareTransaction(
        input,
        wallet.address as Address,
        deps.rpc.evm(input.chainId),
      );
      unsignedTransaction = serializeUnsignedTransaction(prepared);
    } catch (error) {
      throw new ApiError('bad_request', 'Could not prepare the transaction', {
        reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
      });
    }
  } else {
    const inspected = inspectSolana(input.transaction, wallet.address);
    value = assertAllowed(
      checkSessionRequest(session, request, { ...context, solanaTransaction: inspected }),
    );
    unsignedTransaction = input.transaction;
  }

  const reserved = value > 0n;
  if (reserved) await reserve(deps.db, session, value);

  let output: SessionSignOutput;
  try {
    const { signedTransaction } = await deps.keyProvider
      .signTransaction({
        subOrgId,
        walletId: wallet.keyProviderWalletId,
        chainFamily: input.chain,
        unsignedTransaction,
        sessionPolicyId,
      })
      .catch(sessionProviderFailure);

    if (!broadcast) {
      output = { signedTransaction, sponsored: false };
    } else {
      try {
        if (input.chain === 'evm') {
          const hash = await deps.rpc
            .evm(input.chainId)
            .sendRawTransaction(signedTransaction as Hex);
          output = { hash, sponsored: false };
        } else {
          await deps.rpc.solana(input.cluster).sendRawTransaction(base64.decode(signedTransaction));
          output = { hash: transactionId(signedTransaction), sponsored: false };
        }
      } catch (error) {
        throw new ApiError('bad_request', 'The network rejected the transaction', {
          reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
        });
      }
    }
  } catch (error) {
    if (reserved) await release(deps.db, session.id, value);
    throw error;
  }

  await recordSessionSigned(deps, wallet.endUserId, {
    ...meta,
    chain: input.chain,
    broadcast,
    value: value.toString(),
    ...(output.hash ? { hash: output.hash } : {}),
  });
  return output;
}

/**
 * User signer for a sponsored Solana send under a session: the key provider signs the
 * whole transaction with the session policy (so it enforces programs and value), and
 * the user signature is read back from its slot. The gas sponsor verifies it against
 * the message before using it.
 */
function solanaSessionTxSigner(
  deps: SessionDeps,
  subOrgId: string,
  wallet: WalletRow,
  sessionPolicyId: string,
  transaction: string,
): SignBytes {
  return async () => {
    const { signedTransaction } = await deps.keyProvider
      .signTransaction({
        subOrgId,
        walletId: wallet.keyProviderWalletId,
        chainFamily: 'solana',
        unsignedTransaction: transaction,
        sessionPolicyId,
      })
      .catch(sessionProviderFailure);
    return signatureSlot(signedTransaction, wallet.address);
  };
}

/** Signature of `signer` in a base64 transaction (`shortvec(count) || signatures || message`). */
function signatureSlot(base64Tx: string, signer: string): Uint8Array {
  const index = decodeTransaction(base64Tx).requiredSigners.indexOf(signer);
  if (index < 0) throw new ApiError('internal', 'The key provider did not sign the transaction');
  const bytes = base64.decode(base64Tx);
  let offset = 0;
  while (((bytes[offset] ?? 0) & 0x80) !== 0) offset++;
  offset++;
  const start = offset + index * 64;
  return bytes.slice(start, start + 64);
}

async function signSponsoredWithSession(
  deps: SessionDeps,
  session: SessionSignerRow,
  request: Extract<SessionSignRequest, { kind: 'transaction' }>,
  scope: {
    wallet: WalletRow;
    subOrgId: string;
    context: PolicyContext;
    meta: Record<string, unknown>;
  },
): Promise<SessionSignOutput> {
  const { wallet, subOrgId, context, meta } = scope;
  const { input } = request;
  const sponsor = requireSponsor(deps);
  const sessionPolicyId = session.keyProviderPolicyId;

  // Policy first (value, contracts, chains, programs): a refused request is never charged.
  const value =
    input.chain === 'evm'
      ? assertAllowed(
          checkSessionRequest(session, request, {
            ...context,
            evmTransaction: { chainId: input.chainId, to: input.to, value: BigInt(input.value) },
          }),
        )
      : assertAllowed(
          checkSessionRequest(session, request, {
            ...context,
            solanaTransaction: inspectSolana(input.transaction, wallet.address),
          }),
        );

  const reserved = value > 0n;
  if (reserved) await reserve(deps.db, session, value);

  let hash: string;
  try {
    ({ hash } = await sendSponsored(
      { ...deps, sponsor },
      {
        endUserId: wallet.endUserId,
        wallet,
        signers: {
          signHash: evmSessionSigner(deps, subOrgId, wallet, sessionPolicyId),
          signBytes:
            input.chain === 'solana'
              ? solanaSessionTxSigner(deps, subOrgId, wallet, sessionPolicyId, input.transaction)
              : solanaSessionSigner(deps, subOrgId, wallet, sessionPolicyId),
        },
      },
      input,
    ));
  } catch (error) {
    if (reserved) await release(deps.db, session.id, value);
    throw error;
  }

  await recordSessionSigned(deps, wallet.endUserId, {
    ...meta,
    chain: input.chain,
    broadcast: true,
    sponsored: true,
    value: value.toString(),
    hash,
  });
  return { hash, sponsored: true };
}

/* Expiry (hourly cron) */

/**
 * Provider policies cannot express a date: delete the policy of every expired,
 * unrevoked session and flag it revoked. A provider failure leaves the session
 * untouched so the next run retries it.
 */
export async function expireSessions(
  db: Db,
  keyProvider: KeyProvider,
  now = new Date(),
): Promise<{ expired: number; failed: number }> {
  const rows = await db
    .select({
      id: sessionSigners.id,
      policyId: sessionSigners.keyProviderPolicyId,
      subOrgId: endUsers.keyProviderSubOrgId,
    })
    .from(sessionSigners)
    .innerJoin(wallets, eq(wallets.id, sessionSigners.walletId))
    .innerJoin(endUsers, eq(endUsers.id, wallets.endUserId))
    .where(and(isNull(sessionSigners.revokedAt), lte(sessionSigners.expiresAt, now)))
    .limit(500);

  let expired = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.subOrgId) {
      try {
        await keyProvider.deletePolicy({ subOrgId: row.subOrgId, policyId: row.policyId });
      } catch (error) {
        if (!(error instanceof KeyProviderError && error.code === 'not_found')) {
          console.error(`[sessions] could not delete the policy of ${row.id}`, error);
          failed++;
          continue;
        }
      }
    }
    await db
      .update(sessionSigners)
      .set({ revokedAt: now })
      .where(and(eq(sessionSigners.id, row.id), isNull(sessionSigners.revokedAt)));
    expired++;
  }
  return { expired, failed };
}
