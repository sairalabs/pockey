import {
  prepareTransaction,
  serializeUnsignedTransaction,
  signatureToHex,
  signPersonalMessage,
  signTypedDataInput,
  type SignHash,
} from '@pocketkey/chains-evm';
import {
  inspectTransaction,
  signMessage as signSolanaMessage,
  transactionId,
  type InspectedTransaction,
  type SignBytes,
} from '@pocketkey/chains-solana';
import {
  newId,
  usageEvents,
  wallets,
  type AppRow,
  type Db,
  type EndUserRow,
  type WalletRow,
} from '@pocketkey/db';
import { GasSponsorError } from '@pocketkey/gas-sponsor';
import type { KeyProvider, StampedRequest } from '@pocketkey/key-provider';
import {
  AppConfig,
  Wallet,
  type ChainFamily,
  type EvmChainId,
  type EvmTransactionRequest,
  type ExportWalletOutput,
  type PreparedOperation,
  type SendTransactionInput,
  type SendTransactionOutput,
  type SignMessageInput,
  type SignMessageOutput,
  type SignTransactionOutput,
  type SignTypedDataInput,
  type TransactionRequest,
} from '@pocketkey/types';
import { base64 } from '@scure/base';
import { and, eq } from 'drizzle-orm';
import { hexToBytes, type Address, type Hex } from 'viem';
import { consumeChallenge, createChallenge } from '../auth/challenges.js';
import { ApiError } from '../errors.js';
import { randomBytes, toBase64Url } from '../lib/crypto.js';
import type { RpcFactory } from '../lib/rpc.js';
import type { SponsorRuntime } from '../lib/sponsor.js';
import { loadEndUserRow, relayFailure, requireKeySession } from './key-session.js';
import { providerFailure } from './provider-failure.js';
import {
  assertChainEnabled,
  assertSponsoringEnabled,
  prepareSponsoredEvm,
  redactReason,
  sendSponsoredSolana,
  sponsorFailure,
  submitSponsoredEvm,
  type PreparedSponsoredEvm,
} from './sponsored-send.js';

export { providerFailure };

/**
 * Wallet service (T2.3, non-custodial since 2026-09-19). Keys never leave the key
 * provider, and Pocketkey cannot sign with them: every signature here comes from a
 * request the iframe stamped with the user's session key. This code checks that the
 * request is exactly the operation of the route (same digest, same transaction),
 * relays it, and assembles or broadcasts the result.
 */

export interface WalletDeps {
  db: Db;
  keyProvider: KeyProvider;
  rpc: RpcFactory;
  app: AppRow;
  /** Required by sponsored sends and smart account lookups only. */
  sponsor?: SponsorRuntime;
}

/** Prepared operations wait this long for the iframe to sign them. */
const PREPARED_TTL_SECONDS = 2 * 60;

export function toWallet(row: WalletRow): Wallet {
  return Wallet.parse({
    id: row.id,
    endUserId: row.endUserId,
    chainFamily: row.chainFamily,
    address: row.address,
    smartAccountAddress: row.smartAccountAddress,
    createdAt: row.createdAt.toISOString(),
  });
}

export async function listWallets(deps: WalletDeps, endUserId: string): Promise<WalletRow[]> {
  return deps.db.select().from(wallets).where(eq(wallets.endUserId, endUserId));
}

/**
 * Both accounts exist at the provider from sign-up (one wallet, EVM and Solana);
 * this exposes one of them as a Pocketkey wallet.
 */
export async function createWallet(
  deps: WalletDeps,
  endUserId: string,
  chainFamily: ChainFamily,
  options: { ifMissing?: boolean } = {},
): Promise<WalletRow> {
  const existing = await deps.db.query.wallets.findFirst({
    where: and(eq(wallets.endUserId, endUserId), eq(wallets.chainFamily, chainFamily)),
  });
  if (existing) {
    if (options.ifMissing) return existing;
    throw new ApiError('conflict', `This user already has a ${chainFamily} wallet`);
  }

  const user = await loadEndUserRow(deps.db, deps.app, endUserId);
  const account = requireKeySession(user).accounts[chainFamily];
  const [row] = await deps.db
    .insert(wallets)
    .values({
      id: newId('wlt'),
      endUserId,
      chainFamily,
      address: account.address,
      keyProviderWalletId: account.walletId,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Lost a race: another request stored a wallet for this family first.
    const winner = await deps.db.query.wallets.findFirst({
      where: and(eq(wallets.endUserId, endUserId), eq(wallets.chainFamily, chainFamily)),
    });
    if (!winner) throw new ApiError('internal', 'Could not store the wallet');
    return winner;
  }

  await deps.db.insert(usageEvents).values({
    id: newId('evt'),
    appId: deps.app.id,
    endUserId,
    type: 'wallet.created',
    meta: { chainFamily },
  });
  return row;
}

/** `embeddedWallets.createOnLogin` (section 6.1). Idempotent. */
export async function createWalletsOnLogin(deps: WalletDeps, endUserId: string): Promise<void> {
  const mode = AppConfig.parse(deps.app.config).embeddedWallets.createOnLogin;
  const families: ChainFamily[] = mode === 'all' ? ['evm', 'solana'] : mode === 'off' ? [] : [mode];
  for (const family of families) {
    await createWallet(deps, endUserId, family, { ifMissing: true });
  }
}

export interface OwnedWallet {
  wallet: WalletRow;
  user: EndUserRow;
  subOrgId: string;
}

export async function loadOwnedWallet(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
): Promise<OwnedWallet> {
  const wallet = await deps.db.query.wallets.findFirst({
    where: and(eq(wallets.id, walletId), eq(wallets.endUserId, endUserId)),
  });
  // Someone else's wallet and a missing wallet look the same from outside.
  if (!wallet) throw new ApiError('not_found', 'Wallet not found');
  const user = await loadEndUserRow(deps.db, deps.app, endUserId);
  return { wallet, user, subOrgId: requireKeySession(user).organizationId };
}

/** A decodable Solana transaction this wallet must sign, checked before any relay. */
export function inspectSolana(transaction: string, walletAddress: string): InspectedTransaction {
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

/* Signers backed by a stamped request. The chain adapters compute the digest from
   the route input; the provider refuses the relay unless the request signs exactly
   that digest. */

function relayedEvmSigner(deps: WalletDeps, owned: OwnedWallet, request: StampedRequest): SignHash {
  return async (hash) => {
    const { signature } = await deps.keyProvider
      .relay(request, {
        kind: 'signRaw',
        subOrgId: owned.subOrgId,
        address: owned.wallet.address,
        encoding: 'hash',
        payload: hexToBytes(hash),
      })
      .catch(relayFailure);
    return signatureToHex(signature);
  };
}

function relayedSolanaSigner(
  deps: WalletDeps,
  owned: OwnedWallet,
  request: StampedRequest,
): SignBytes {
  return async (bytes) => {
    const { signature } = await deps.keyProvider
      .relay(request, {
        kind: 'signRaw',
        subOrgId: owned.subOrgId,
        address: owned.wallet.address,
        encoding: 'raw',
        payload: bytes,
      })
      .catch(relayFailure);
    return signature;
  };
}

function assertFamily(wallet: WalletRow, chain: ChainFamily): void {
  if (wallet.chainFamily !== chain) {
    throw new ApiError(
      'bad_request',
      `This is a ${wallet.chainFamily} wallet, the request targets ${chain}`,
    );
  }
}

async function recordTx(
  deps: WalletDeps,
  endUserId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await deps.db
    .insert(usageEvents)
    .values({ id: newId('evt'), appId: deps.app.id, endUserId, type: 'tx.signed', meta });
}

export async function signMessage(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: SignMessageInput,
  request: StampedRequest,
): Promise<SignMessageOutput> {
  const owned = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(owned.wallet, input.chain);

  if (input.chain === 'evm') {
    const message =
      typeof input.message === 'string' ? input.message : { raw: input.message.raw as Hex };
    return {
      signature: await signPersonalMessage(message, relayedEvmSigner(deps, owned, request)),
    };
  }
  return {
    signature: await signSolanaMessage(input.message, relayedSolanaSigner(deps, owned, request)),
  };
}

export async function signTypedData(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: SignTypedDataInput,
  request: StampedRequest,
): Promise<SignMessageOutput> {
  const owned = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(owned.wallet, 'evm');
  return { signature: await signTypedDataInput(input, relayedEvmSigner(deps, owned, request)) };
}

/* Two step operations: the API prepares, the iframe checks and signs, the API submits.
   The prepared operation is kept server side under a single-use ticket, bound to the
   user, the wallet and the exact input. */

interface StoredOperation {
  walletId: string;
  input: string;
  unsignedTransaction?: string;
  sponsored?: PreparedSponsoredEvm;
}

/** Canonical JSON (sorted keys): the same input always gives the same key. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

const inputKey = (input: TransactionRequest | SendTransactionInput) =>
  JSON.stringify(canonical({ sponsored: false, ...input }));

async function storeOperation(
  deps: WalletDeps,
  endUserId: string,
  operation: StoredOperation,
): Promise<string> {
  const ticket = toBase64Url(randomBytes(24));
  await createChallenge(deps.db, {
    id: ticket,
    appId: deps.app.id,
    purpose: 'prepared_operation',
    subject: endUserId,
    payload: operation as unknown as Record<string, unknown>,
    ttlSeconds: PREPARED_TTL_SECONDS,
  });
  return ticket;
}

async function takeOperation(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  ticket: string | undefined,
  input: TransactionRequest | SendTransactionInput,
): Promise<StoredOperation> {
  if (!ticket) throw new ApiError('bad_request', 'Prepare this transaction first');
  const row = await consumeChallenge(deps.db, {
    id: ticket,
    appId: deps.app.id,
    purpose: 'prepared_operation',
  });
  const operation = row?.payload as StoredOperation | undefined;
  if (
    row?.subject !== endUserId ||
    operation?.walletId !== walletId ||
    operation.input !== inputKey(input)
  ) {
    throw new ApiError('bad_request', 'This prepared transaction expired or does not match', {
      reason: 'prepared_mismatch',
    });
  }
  return operation;
}

export async function prepareOperation(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: SendTransactionInput,
): Promise<PreparedOperation> {
  assertChainEnabled(deps.app, input);
  const owned = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(owned.wallet, input.chain);
  if (input.chain === 'solana') return { kind: 'none' };

  if (input.sponsored) {
    assertSponsoringEnabled(deps.app, 'evm');
    const sponsor = requireSponsor(deps);
    const prepared = await prepareSponsoredEvm(
      { ...deps, sponsor },
      { wallet: owned.wallet },
      input,
    );
    const ticket = await storeOperation(deps, endUserId, {
      walletId,
      input: inputKey(input),
      sponsored: prepared,
    });
    return {
      kind: 'userOperation',
      ticket,
      chainId: input.chainId,
      entryPointAddress: prepared.entryPointAddress,
      userOperation: prepared.userOperation,
      digest: prepared.digest,
    };
  }

  const unsignedTransaction = await prepareEvm(deps, owned.wallet, input);
  const ticket = await storeOperation(deps, endUserId, {
    walletId,
    input: inputKey(input),
    unsignedTransaction,
  });
  return { kind: 'transaction', ticket, unsignedTransaction };
}

async function prepareEvm(
  deps: WalletDeps,
  wallet: WalletRow,
  input: EvmTransactionRequest,
): Promise<string> {
  try {
    const prepared = await prepareTransaction(
      input,
      wallet.address as Address,
      deps.rpc.evm(input.chainId),
    );
    return serializeUnsignedTransaction(prepared);
  } catch (error) {
    throw new ApiError('bad_request', 'Could not prepare the transaction', {
      reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    });
  }
}

/** Signs a transaction with a relayed request. EVM needs the ticket from `prepare`. */
async function signTx(
  deps: WalletDeps,
  owned: OwnedWallet,
  input: TransactionRequest,
  request: StampedRequest,
  ticket: string | undefined,
  preparedInput: TransactionRequest | SendTransactionInput,
): Promise<string> {
  assertChainEnabled(deps.app, input);
  assertFamily(owned.wallet, input.chain);

  let unsignedTransaction: string;
  if (input.chain === 'evm') {
    const operation = await takeOperation(
      deps,
      owned.wallet.endUserId,
      owned.wallet.id,
      ticket,
      preparedInput,
    );
    if (!operation.unsignedTransaction)
      throw new ApiError('bad_request', 'Wrong prepared operation');
    unsignedTransaction = operation.unsignedTransaction;
  } else {
    inspectSolana(input.transaction, owned.wallet.address);
    unsignedTransaction = input.transaction;
  }

  const { signedTransaction } = await deps.keyProvider
    .relay(request, {
      kind: 'signTransaction',
      subOrgId: owned.subOrgId,
      address: owned.wallet.address,
      chainFamily: input.chain,
      unsignedTransaction,
    })
    .catch(relayFailure);
  return signedTransaction;
}

export async function signTransaction(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: TransactionRequest,
  request: StampedRequest,
  ticket?: string,
): Promise<SignTransactionOutput> {
  const owned = await loadOwnedWallet(deps, endUserId, walletId);
  const signed = await signTx(deps, owned, input, request, ticket, input);
  await recordTx(deps, endUserId, { chain: input.chain, broadcast: false });
  return { signedTransaction: signed };
}

export async function sendTransaction(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: SendTransactionInput,
  request: StampedRequest,
  ticket?: string,
): Promise<SendTransactionOutput> {
  const owned = await loadOwnedWallet(deps, endUserId, walletId);

  if (input.sponsored) {
    // T4.4 to T4.6: prepaid sponsoring, Solana fee payer or ERC-4337 smart account.
    assertSponsoringEnabled(deps.app, input.chain);
    assertChainEnabled(deps.app, input);
    assertFamily(owned.wallet, input.chain);
    const sponsor = requireSponsor(deps);
    let hash: string;
    if (input.chain === 'solana') {
      inspectSolana(input.transaction, owned.wallet.address);
      ({ hash } = await sendSponsoredSolana(
        { ...deps, sponsor },
        {
          endUserId,
          wallet: owned.wallet,
          signUserTransaction: async (transaction) =>
            (
              await deps.keyProvider
                .relay(request, {
                  kind: 'signTransaction',
                  subOrgId: owned.subOrgId,
                  address: owned.wallet.address,
                  chainFamily: 'solana',
                  unsignedTransaction: transaction,
                })
                .catch(relayFailure)
            ).signedTransaction,
        },
        input,
      ));
    } else {
      const operation = await takeOperation(deps, endUserId, walletId, ticket, input);
      if (!operation.sponsored) throw new ApiError('bad_request', 'Wrong prepared operation');
      const prepared = operation.sponsored;
      ({ hash } = await submitSponsoredEvm(
        { ...deps, sponsor },
        { endUserId, wallet: owned.wallet },
        input,
        prepared,
        relayedEvmSigner(deps, owned, request),
      ));
    }
    await recordTx(deps, endUserId, { chain: input.chain, broadcast: true, hash, sponsored: true });
    return { hash, sponsored: true };
  }

  const signed = await signTx(deps, owned, input, request, ticket, input);
  let hash: string;
  try {
    if (input.chain === 'evm') {
      hash = await deps.rpc.evm(input.chainId).sendRawTransaction(signed as Hex);
    } else {
      await deps.rpc.solana(input.cluster).sendRawTransaction(base64.decode(signed));
      hash = transactionId(signed);
    }
  } catch (error) {
    throw new ApiError('bad_request', 'The network rejected the transaction', {
      reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    });
  }

  await recordTx(deps, endUserId, { chain: input.chain, broadcast: true, hash });
  return { hash, sponsored: false };
}

export function requireSponsor(deps: WalletDeps): SponsorRuntime {
  if (!deps.sponsor) throw new ApiError('internal', 'Gas sponsoring is not wired on this route');
  return deps.sponsor;
}

/**
 * Kernel smart account owned by an EVM wallet (T4.5). Sponsored EVM sends come from
 * this address, not from the wallet EOA. Computing it signs nothing.
 */
export async function smartAccountAddress(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  chainId: EvmChainId,
): Promise<string> {
  const factory = requireSponsor(deps).evm;
  const { wallet } = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(wallet, 'evm');
  assertChainEnabled(deps.app, { chain: 'evm', chainId });
  if (!factory) {
    throw new ApiError('bad_request', 'EVM gas sponsoring is not configured on this server');
  }
  try {
    return await factory.getSmartAccountAddress({
      chainId,
      owner: { address: wallet.address as Address },
    });
  } catch (error) {
    if (error instanceof ApiError || error instanceof GasSponsorError) sponsorFailure(error);
    throw new ApiError('bad_request', 'Could not compute the smart account address', {
      reason: redactReason(error),
    });
  }
}

/** Section 8.4: encrypted by the provider to a key that never leaves the iframe. */
export async function exportWallet(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  request: StampedRequest,
): Promise<ExportWalletOutput> {
  const owned = await loadOwnedWallet(deps, endUserId, walletId);
  const { exportBundle } = await deps.keyProvider
    .relay(request, {
      kind: 'exportAccount',
      subOrgId: owned.subOrgId,
      address: owned.wallet.address,
    })
    .catch(relayFailure);
  return { encryptedBundle: exportBundle };
}
