import {
  createCoinGeckoPriceFeed,
  createPimlicoClientsFactory,
  createStaticPriceFeed,
  type EvmSponsorClientsFactory,
  type PriceFeed,
} from '@pockey/gas-sponsor';
import { createMockPayments, createStripePayments, type Payments } from '@pockey/payments';
import { EVM_CHAINS, EvmChainId } from '@pockey/types';
import type { Context } from 'hono';
import type { AppEnv } from '../context.js';
import type { ParsedEnv } from '../env.js';

/**
 * Gas sponsoring and payment ports, one instance per isolate like
 * the key provider. Each getter has a test hook in the style of `setRpcFactory`.
 */

/** Development and test prices, in USD per unit. */
export const STATIC_PRICES = { ETH: 3000, SOL: 150, POL: 0.5 } as const;

let payments: Payments | undefined;
let paymentsOverride: Payments | undefined;

export function getPayments(config: ParsedEnv): Payments {
  if (paymentsOverride) return paymentsOverride;
  if (payments) return payments;
  switch (config.PAYMENTS) {
    case 'mock':
      payments = createMockPayments({ baseUrl: config.API_BASE_URL });
      break;
    case 'stripe':
      // env.ts refuses PAYMENTS=stripe without both secrets.
      if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
        throw new Error('Stripe secrets missing');
      }
      payments = createStripePayments({
        secretKey: config.STRIPE_SECRET_KEY,
        webhookSecret: config.STRIPE_WEBHOOK_SECRET,
        // Absent outside production: the subscription and meter methods
        // then refuse, which `services/billing.ts` degrades into a 400.
        ...(config.STRIPE_ACTIVE_WALLET_PRICE_ID === undefined
          ? {}
          : { activeWalletPriceId: config.STRIPE_ACTIVE_WALLET_PRICE_ID }),
        ...(config.STRIPE_ACTIVE_WALLET_METER_NAME === undefined
          ? {}
          : { activeWalletMeterName: config.STRIPE_ACTIVE_WALLET_METER_NAME }),
      });
      break;
  }
  return payments;
}

/** Test hook. Pass undefined to restore the configured implementation. */
export function setPaymentsForTests(value: Payments | undefined): void {
  paymentsOverride = value;
}

let priceFeed: PriceFeed | undefined;
let priceFeedOverride: PriceFeed | undefined;

export function getPriceFeed(config: ParsedEnv): PriceFeed {
  if (priceFeedOverride) return priceFeedOverride;
  priceFeed ??=
    config.PRICE_FEED === 'coingecko'
      ? createCoinGeckoPriceFeed()
      : createStaticPriceFeed({ ...STATIC_PRICES });
  return priceFeed;
}

/** Test hook. Pass undefined to restore the configured implementation. */
export function setPriceFeedForTests(value: PriceFeed | undefined): void {
  priceFeedOverride = value;
}

let evmFactory: EvmSponsorClientsFactory | undefined;
/** `null` forces "not configured", `undefined` restores the configured factory. */
let evmFactoryOverride: EvmSponsorClientsFactory | null | undefined;

/** Pimlico bundler and paymaster when `PIMLICO_API_KEY` is set, otherwise null. */
export function getEvmSponsorFactory(config: ParsedEnv): EvmSponsorClientsFactory | null {
  if (evmFactoryOverride !== undefined) return evmFactoryOverride;
  if (!config.PIMLICO_API_KEY) return null;
  if (evmFactory) return evmFactory;

  const rpcUrls: Partial<Record<EvmChainId, string>> = {};
  for (const key of Object.keys(EVM_CHAINS)) {
    const chainId = EvmChainId.safeParse(Number(key));
    const url = config.RPC_URLS[key];
    if (chainId.success && url) rpcUrls[chainId.data] = url;
  }
  evmFactory = createPimlicoClientsFactory({ apiKey: config.PIMLICO_API_KEY, rpcUrls });
  return evmFactory;
}

/** Test hook. */
export function setEvmSponsorFactoryForTests(value: EvmSponsorClientsFactory | null | undefined) {
  evmFactoryOverride = value;
}

/** What a sponsored send needs besides the database, the key provider and the RPCs. */
export interface SponsorRuntime {
  prices: PriceFeed;
  evm: EvmSponsorClientsFactory | null;
  /** Work that continues after the response (EVM receipt settlement). Never rejects. */
  waitUntil: (task: Promise<unknown>) => void;
}

export function sponsorRuntime(c: Context<AppEnv>): SponsorRuntime {
  let ctx: { waitUntil(promise: Promise<unknown>): void } | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    // `app.request` without an execution context (some tests): the task still runs.
    ctx = undefined;
  }
  return {
    prices: getPriceFeed(c.var.config),
    evm: getEvmSponsorFactory(c.var.config),
    waitUntil: (task) => {
      const guarded = task.catch((error: unknown) => {
        console.error('[sponsor] background task failed', error);
      });
      ctx?.waitUntil(guarded);
    },
  };
}
