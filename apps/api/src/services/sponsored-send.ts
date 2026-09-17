import type { SignHash } from '@pocketkey/chains-evm';
import { SolanaTransactionError, transactionId, type SignBytes } from '@pocketkey/chains-solana';
import { newId, usageEvents, wallets, type AppRow, type Db, type WalletRow } from '@pocketkey/db';
import {
  chargedCents,
  GasSponsorError,
  maxGasCostWei,
  nativeAssetFor,
  sponsorSolanaTransaction,
  validateSponsoredSolanaTransaction,
  type EvmSponsorClientsFactory,
  type PreparedUserOperation,
  type PriceFeed,
} from '@pocketkey/gas-sponsor';
import { KeyProviderError, type KeyProvider } from '@pocketkey/key-provider';
import {
  AppConfig,
  type ChainFamily,
  type EvmTransactionRequest,
  type SolanaTransactionRequest,
  type TransactionRequest,
} from '@pocketkey/types';
import { base64 } from '@scure/base';
import { and, eq, isNull } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { ApiError } from '../errors.js';
import type { RpcFactory } from '../lib/rpc.js';
import type { SponsorRuntime } from '../lib/sponsor.js';
import { providerFailure } from './provider-failure.js';
import {
  charge,
  ensureSolanaFeePayer,
  getBalance,
  refundQuietly,
  type SponsorCharge,
} from './sponsoring.js';

/**
 * Sponsored sends (T4.4, T4.5), shared by `POST /v1/wallets/:id/send-transaction`
 * and session signing. The balance is charged before anything reaches the network;
 * any failure after the charge refunds it in full.
 */

export interface SponsoredSendDeps {
  db: Db;
  keyProvider: KeyProvider;
  rpc: RpcFactory;
  app: AppRow;
  sponsor: SponsorRuntime;
}

/** How the end user signs: interactively, or under a session policy. */
export interface SponsoredUserSigners {
  /** EVM: signs the user operation hash as the smart account owner. */
  signHash: SignHash;
  /** Solana: signs the transaction message bytes. */
  signBytes: SignBytes;
}

export interface SponsoredSendTarget {
  endUserId: string;
  wallet: WalletRow;
  signers: SponsoredUserSigners;
}

/**
 * EVM receipts are awaited in `waitUntil`, which Workers bound to 30 seconds after
 * the response. Past this, the operation keeps its maximum charge (no refund).
 */
export const RECEIPT_WAIT_MS = 25_000;

export function assertSponsoringEnabled(app: AppRow, chain: ChainFamily): void {
  if (!AppConfig.parse(app.config).gasSponsoring[chain]) {
    throw new ApiError('forbidden', 'Gas sponsoring is disabled for this app');
  }
}

export function assertChainEnabled(
  app: AppRow,
  request:
    | Pick<EvmTransactionRequest, 'chain' | 'chainId'>
    | Pick<SolanaTransactionRequest, 'chain' | 'cluster'>,
): void {
  const chains = AppConfig.parse(app.config).chains;
  const enabled =
    request.chain === 'evm'
      ? chains.evm.includes(request.chainId)
      : chains.solana.includes(request.cluster);
  if (!enabled) {
    const label =
      request.chain === 'evm' ? `chain ${request.chainId}` : `cluster ${request.cluster}`;
    throw new ApiError('forbidden', `${label} is not enabled for this app`);
  }
}

/** Bundler and RPC errors may quote URLs that carry API keys. */
function redact(text: string): string {
  return text.replace(/(apikey=)[^&\s"']+/gi, '$1***').slice(0, 300);
}

/** Error message safe to return in `details.reason`: truncated, API keys removed. */
export function redactReason(error: unknown): string {
  return redact(error instanceof Error ? error.message : 'unknown');
}

/** Maps gas sponsor, Solana codec and key provider failures to API errors. */
export function sponsorFailure(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof GasSponsorError) {
    switch (error.code) {
      case 'price_unavailable':
        throw new ApiError('internal', 'Gas price feed unavailable, retry later', {
          reason: error.code,
        });
      case 'bundler_error':
        throw new ApiError('bad_request', 'The bundler rejected the user operation', {
          reason: error.code,
          message: redact(error.message),
        });
      default:
        throw new ApiError('bad_request', error.message, { reason: error.code });
    }
  }
  if (error instanceof SolanaTransactionError) {
    throw new ApiError('bad_request', error.message);
  }
  if (error instanceof KeyProviderError) providerFailure(error);
  throw error;
}

async function priceOf(prices: PriceFeed, asset: 'ETH' | 'SOL' | 'POL'): Promise<number> {
  try {
    return await prices.usdPerUnit(asset);
  } catch (error) {
    return sponsorFailure(error);
  }
}

async function recordSponsored(
  deps: SponsoredSendDeps,
  endUserId: string,
  amount: bigint,
  meta: Record<string, unknown>,
): Promise<void> {
  await deps.db.insert(usageEvents).values({
    id: newId('evt'),
    appId: deps.app.id,
    endUserId,
    type: 'tx.sponsored',
    amount: amount.toString(),
    meta,
  });
}

export async function sendSponsored(
  deps: SponsoredSendDeps,
  target: SponsoredSendTarget,
  input: TransactionRequest,
): Promise<{ hash: string }> {
  assertSponsoringEnabled(deps.app, input.chain);
  assertChainEnabled(deps.app, input);
  if (target.wallet.chainFamily !== input.chain) {
    throw new ApiError(
      'bad_request',
      `This is a ${target.wallet.chainFamily} wallet, the request targets ${input.chain}`,
    );
  }
  return input.chain === 'solana'
    ? sendSponsoredSolana(deps, target, input)
    : sendSponsoredEvm(deps, target, input);
}

/* Solana: the app fee payer co-signs */

async function sendSponsoredSolana(
  deps: SponsoredSendDeps,
  target: SponsoredSendTarget,
  input: SolanaTransactionRequest,
): Promise<{ hash: string }> {
  const { db, app } = deps;
  const feePayer = await ensureSolanaFeePayer(deps, app);

  let feeLamports: bigint;
  try {
    ({ feeLamports } = validateSponsoredSolanaTransaction(input.transaction, feePayer.address));
  } catch (error) {
    return sponsorFailure(error);
  }

  // Daily cap. Read then charge: two concurrent sends can both pass the last few
  // lamports of the cap, the prepaid balance itself is still enforced atomically.
  const balance = await getBalance(db, app);
  const cap = BigInt(balance.solanaDailyCapLamports);
  const spent = BigInt(balance.solanaSpentTodayLamports);
  if (cap > 0n && spent + feeLamports > cap) {
    throw new ApiError('rate_limited', 'The daily Solana sponsoring cap of this app is reached', {
      reason: 'solana_daily_cap_reached',
      solanaSpentTodayLamports: spent.toString(),
      solanaDailyCapLamports: cap.toString(),
      feeLamports: feeLamports.toString(),
    });
  }

  const usdPerUnit = await priceOf(deps.sponsor.prices, 'SOL');
  const cents = chargedCents({ amount: feeLamports, decimals: 9, usdPerUnit });
  const handle = await charge(db, app, {
    cents,
    reference: `sponsor:solana:${crypto.randomUUID()}`,
    meta: {
      chain: 'solana',
      cluster: input.cluster,
      walletId: target.wallet.id,
      feeLamports: feeLamports.toString(),
      usdPerUnit,
    },
  });

  let hash: string;
  try {
    let signedTransaction: string;
    try {
      ({ signedTransaction } = await sponsorSolanaTransaction({
        transaction: input.transaction,
        user: { address: target.wallet.address, signBytes: target.signers.signBytes },
        feePayer: {
          address: feePayer.address,
          signBytes: async (bytes) => {
            const { signature } = await deps.keyProvider
              .signRaw({
                subOrgId: feePayer.keyProviderSubOrgId,
                walletId: feePayer.keyProviderWalletId,
                payload: bytes,
                encoding: 'raw',
              })
              .catch(providerFailure);
            return signature;
          },
        },
      }));
    } catch (error) {
      return sponsorFailure(error);
    }

    try {
      await deps.rpc.solana(input.cluster).sendRawTransaction(base64.decode(signedTransaction));
    } catch (error) {
      throw new ApiError('bad_request', 'The network rejected the transaction', {
        reason: redactReason(error),
      });
    }
    hash = transactionId(signedTransaction);
  } catch (error) {
    await refundQuietly(db, app, handle, handle.cents, 'send_failed');
    throw error;
  }

  await recordSponsored(deps, target.endUserId, feeLamports, {
    chain: 'solana',
    cluster: input.cluster,
    cents,
    hash,
  });
  return { hash };
}

/* EVM: ERC-4337 user operation from the Kernel smart account */

async function sendSponsoredEvm(
  deps: SponsoredSendDeps,
  target: SponsoredSendTarget,
  input: EvmTransactionRequest,
): Promise<{ hash: string }> {
  const { db, app } = deps;
  const factory = deps.sponsor.evm;
  if (!factory) {
    throw new ApiError('bad_request', 'EVM gas sponsoring is not configured on this server');
  }
  const { chainId } = input;
  const owner = { address: target.wallet.address as Address, signHash: target.signers.signHash };

  // Gas overrides and nonce of the request do not apply: the bundler and the
  // paymaster set them on the user operation.
  let prepared: PreparedUserOperation;
  try {
    prepared = await factory.prepareUserOperation({
      chainId,
      owner,
      calls: [{ to: input.to as Address, value: BigInt(input.value), data: input.data as Hex }],
    });
  } catch (error) {
    if (error instanceof ApiError || error instanceof GasSponsorError) sponsorFailure(error);
    throw new ApiError('bad_request', 'Could not prepare the sponsored user operation', {
      reason: redactReason(error),
    });
  }

  const maxCost = maxGasCostWei(prepared);
  const asset = nativeAssetFor({ family: 'evm', chainId });
  const usdPerUnit = await priceOf(deps.sponsor.prices, asset);
  const cents = chargedCents({ amount: maxCost, decimals: 18, usdPerUnit });
  const handle = await charge(db, app, {
    cents,
    reference: `sponsor:evm:${crypto.randomUUID()}`,
    meta: {
      chain: 'evm',
      chainId,
      walletId: target.wallet.id,
      maxGasCostWei: maxCost.toString(),
      asset,
      usdPerUnit,
    },
  });

  let userOpHash: Hex;
  try {
    // Signs this exact prepared operation (no second paymaster round trip) and submits it.
    userOpHash = await prepared.send();
  } catch (error) {
    await refundQuietly(db, app, handle, handle.cents, 'send_failed');
    if (error instanceof ApiError || error instanceof GasSponsorError) sponsorFailure(error);
    throw new ApiError('bad_request', 'The bundler rejected the user operation', {
      reason: redactReason(error),
    });
  }

  if (!target.wallet.smartAccountAddress) {
    await db
      .update(wallets)
      .set({ smartAccountAddress: prepared.sender })
      .where(and(eq(wallets.id, target.wallet.id), isNull(wallets.smartAccountAddress)));
  }

  await recordSponsored(deps, target.endUserId, maxCost, {
    chain: 'evm',
    chainId,
    cents,
    hash: userOpHash,
  });

  deps.sponsor.waitUntil(
    settleEvmCharge({ db, app, factory }, handle, {
      chainId,
      userOpHash,
      usdPerUnit,
    }),
  );
  return { hash: userOpHash };
}

/**
 * Best effort: once the receipt arrives, refund what the operation did not use,
 * priced with the same USD rate as the charge. Failures are logged, the app keeps
 * the maximum charge.
 */
export async function settleEvmCharge(
  deps: { db: Db; app: AppRow; factory: EvmSponsorClientsFactory },
  handle: SponsorCharge,
  input: { chainId: EvmTransactionRequest['chainId']; userOpHash: Hex; usdPerUnit: number },
): Promise<void> {
  try {
    const receipt = await deps.factory.waitForUserOperationReceipt({
      chainId: input.chainId,
      userOpHash: input.userOpHash,
      timeoutMs: RECEIPT_WAIT_MS,
    });
    const actualCents = chargedCents({
      amount: receipt.actualGasCost,
      decimals: 18,
      usdPerUnit: input.usdPerUnit,
    });
    const difference = handle.cents - actualCents;
    if (difference > 0) {
      await refundQuietly(deps.db, deps.app, handle, difference, 'unused_gas');
    }
  } catch (error) {
    console.warn(`[sponsor] no receipt settlement for ${input.userOpHash}: ${redactReason(error)}`);
  }
}
