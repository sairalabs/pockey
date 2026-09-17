import {
  prepareTransaction,
  signatureToHex,
  signPersonalMessage,
  signTransaction as signEvmTransaction,
  signTypedDataInput,
  type SignHash,
} from '@pocketkey/chains-evm';
import {
  signMessage as signSolanaMessage,
  signTransaction as signSolanaTransaction,
  transactionId,
  type SignBytes,
} from '@pocketkey/chains-solana';
import {
  endUsers,
  newId,
  usageEvents,
  wallets,
  type AppRow,
  type Db,
  type WalletRow,
} from '@pocketkey/db';
import { GasSponsorError } from '@pocketkey/gas-sponsor';
import type { KeyProvider } from '@pocketkey/key-provider';
import {
  AppConfig,
  CURVE_BY_FAMILY,
  Wallet,
  type ChainFamily,
  type EvmChainId,
  type ExportWalletOutput,
  type SendTransactionInput,
  type SendTransactionOutput,
  type SignMessageInput,
  type SignMessageOutput,
  type SignTransactionOutput,
  type SignTypedDataInput,
  type TransactionRequest,
} from '@pocketkey/types';
import { base64 } from '@scure/base';
import { and, eq, isNull } from 'drizzle-orm';
import { hexToBytes, type Address, type Hex } from 'viem';
import { ApiError } from '../errors.js';
import type { RpcFactory } from '../lib/rpc.js';
import type { SponsorRuntime } from '../lib/sponsor.js';
import { providerFailure } from './provider-failure.js';
import {
  assertChainEnabled,
  assertSponsoringEnabled,
  redactReason,
  sendSponsored,
  sponsorFailure,
} from './sponsored-send.js';

export { providerFailure };

/**
 * Wallet service (T2.3). Keys never leave the key provider: this code builds
 * digests or message bytes, asks `KeyProvider.signRaw` for a signature, and
 * assembles the result with the chain adapters.
 */

export interface WalletDeps {
  db: Db;
  keyProvider: KeyProvider;
  rpc: RpcFactory;
  app: AppRow;
  /** Required by sponsored sends and smart account lookups only. */
  sponsor?: SponsorRuntime;
}

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

async function ensureSubOrg(deps: WalletDeps, endUserId: string): Promise<string> {
  const user = await deps.db.query.endUsers.findFirst({
    where: and(eq(endUsers.id, endUserId), eq(endUsers.appId, deps.app.id)),
  });
  if (!user) throw new ApiError('not_found', 'End user not found');
  if (user.keyProviderSubOrgId) return user.keyProviderSubOrgId;

  const { subOrgId } = await deps.keyProvider
    .createSubOrganization({
      endUserId,
      auth: { type: 'email', email: `${endUserId}@users.pocketkey.dev` },
    })
    .catch(providerFailure);

  // Conditional write: if a concurrent request already attached a sub-org, keep theirs.
  const [claimed] = await deps.db
    .update(endUsers)
    .set({ keyProviderSubOrgId: subOrgId })
    .where(and(eq(endUsers.id, endUserId), isNull(endUsers.keyProviderSubOrgId)))
    .returning({ subOrgId: endUsers.keyProviderSubOrgId });
  if (claimed?.subOrgId) return claimed.subOrgId;

  const winner = await deps.db.query.endUsers.findFirst({ where: eq(endUsers.id, endUserId) });
  if (!winner?.keyProviderSubOrgId)
    throw new ApiError('internal', 'Could not attach a key provider sub-organization');
  return winner.keyProviderSubOrgId;
}

export async function listWallets(deps: WalletDeps, endUserId: string): Promise<WalletRow[]> {
  return deps.db.select().from(wallets).where(eq(wallets.endUserId, endUserId));
}

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

  const subOrgId = await ensureSubOrg(deps, endUserId);
  const created = await deps.keyProvider
    .createWallet({ subOrgId, curve: CURVE_BY_FAMILY[chainFamily] })
    .catch(providerFailure);

  const [row] = await deps.db
    .insert(wallets)
    .values({
      id: newId('wlt'),
      endUserId,
      chainFamily,
      address: created.address,
      keyProviderWalletId: created.walletId,
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

export async function loadOwnedWallet(deps: WalletDeps, endUserId: string, walletId: string) {
  const wallet = await deps.db.query.wallets.findFirst({
    where: and(eq(wallets.id, walletId), eq(wallets.endUserId, endUserId)),
  });
  // Someone else's wallet and a missing wallet look the same from outside.
  if (!wallet) throw new ApiError('not_found', 'Wallet not found');
  const user = await deps.db.query.endUsers.findFirst({ where: eq(endUsers.id, endUserId) });
  if (!user?.keyProviderSubOrgId)
    throw new ApiError('internal', 'Wallet has no key provider sub-organization');
  return { wallet, subOrgId: user.keyProviderSubOrgId };
}

function evmSigner(deps: WalletDeps, subOrgId: string, walletId: string): SignHash {
  return async (hash) => {
    const { signature } = await deps.keyProvider
      .signRaw({ subOrgId, walletId, payload: hexToBytes(hash), encoding: 'hash' })
      .catch(providerFailure);
    return signatureToHex(signature);
  };
}

function solanaSigner(deps: WalletDeps, subOrgId: string, walletId: string): SignBytes {
  return async (bytes) => {
    const { signature } = await deps.keyProvider
      .signRaw({ subOrgId, walletId, payload: bytes, encoding: 'raw' })
      .catch(providerFailure);
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
): Promise<SignMessageOutput> {
  const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(wallet, input.chain);
  const key = wallet.keyProviderWalletId;

  if (input.chain === 'evm') {
    const message =
      typeof input.message === 'string' ? input.message : { raw: input.message.raw as Hex };
    return { signature: await signPersonalMessage(message, evmSigner(deps, subOrgId, key)) };
  }
  return { signature: await signSolanaMessage(input.message, solanaSigner(deps, subOrgId, key)) };
}

export async function signTypedData(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: SignTypedDataInput,
): Promise<SignMessageOutput> {
  const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(wallet, 'evm');
  return {
    signature: await signTypedDataInput(
      input,
      evmSigner(deps, subOrgId, wallet.keyProviderWalletId),
    ),
  };
}

async function signTx(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: TransactionRequest,
): Promise<{ signed: string; wallet: WalletRow }> {
  assertChainEnabled(deps.app, input);
  const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(wallet, input.chain);
  const key = wallet.keyProviderWalletId;

  if (input.chain === 'evm') {
    const rpc = deps.rpc.evm(input.chainId);
    const prepared = await prepareTransaction(input, wallet.address as Address, rpc);
    return { signed: await signEvmTransaction(prepared, evmSigner(deps, subOrgId, key)), wallet };
  }

  const signed = await signSolanaTransaction(input.transaction, {
    publicKey: wallet.address,
    signBytes: solanaSigner(deps, subOrgId, key),
  }).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      'bad_request',
      error instanceof Error ? error.message : 'Invalid Solana transaction',
    );
  });
  return { signed, wallet };
}

export async function signTransaction(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: TransactionRequest,
): Promise<SignTransactionOutput> {
  const { signed } = await signTx(deps, endUserId, walletId, input);
  await recordTx(deps, endUserId, { chain: input.chain, broadcast: false });
  return { signedTransaction: signed };
}

export async function sendTransaction(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  input: SendTransactionInput,
): Promise<SendTransactionOutput> {
  if (input.sponsored) {
    // T4.4 to T4.6: prepaid sponsoring, Solana fee payer or ERC-4337 smart account.
    assertSponsoringEnabled(deps.app, input.chain);
    const sponsor = requireSponsor(deps);
    const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, walletId);
    const key = wallet.keyProviderWalletId;
    const { hash } = await sendSponsored(
      { ...deps, sponsor },
      {
        endUserId,
        wallet,
        signers: {
          signHash: evmSigner(deps, subOrgId, key),
          signBytes: solanaSigner(deps, subOrgId, key),
        },
      },
      input,
    );
    await recordTx(deps, endUserId, { chain: input.chain, broadcast: true, hash, sponsored: true });
    return { hash, sponsored: true };
  }
  const { signed } = await signTx(deps, endUserId, walletId, input);

  let hash: string;
  try {
    if (input.chain === 'evm') {
      hash = await deps.rpc.evm(input.chainId).sendRawTransaction(signed as `0x${string}`);
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
  const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, walletId);
  assertFamily(wallet, 'evm');
  assertChainEnabled(deps.app, { chain: 'evm', chainId });
  if (!factory) {
    throw new ApiError('bad_request', 'EVM gas sponsoring is not configured on this server');
  }
  try {
    return await factory.getSmartAccountAddress({
      chainId,
      owner: {
        address: wallet.address as Address,
        signHash: evmSigner(deps, subOrgId, wallet.keyProviderWalletId),
      },
    });
  } catch (error) {
    if (error instanceof ApiError || error instanceof GasSponsorError) sponsorFailure(error);
    throw new ApiError('bad_request', 'Could not compute the smart account address', {
      reason: redactReason(error),
    });
  }
}

export async function exportWallet(
  deps: WalletDeps,
  endUserId: string,
  walletId: string,
  targetPublicKey: string,
): Promise<ExportWalletOutput> {
  const { wallet, subOrgId } = await loadOwnedWallet(deps, endUserId, walletId);
  // Section 8.4: the bundle is encrypted to a key generated inside the iframe.
  // This service only relays ciphertext and never sees key material.
  const { encryptedBundle } = await deps.keyProvider
    .exportWallet({ subOrgId, walletId: wallet.keyProviderWalletId, targetPublicKey })
    .catch(providerFailure);
  return { encryptedBundle };
}
