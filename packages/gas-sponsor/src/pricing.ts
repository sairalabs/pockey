import { SPONSOR_MARGIN, type EvmChainId } from '@pockey/types';
import { GasSponsorError } from './errors.js';

/** Native gas assets of the supported chains. */
export type NativeAsset = 'ETH' | 'SOL' | 'POL';

export const NATIVE_ASSETS: readonly NativeAsset[] = ['ETH', 'SOL', 'POL'];

/** USD price source for native gas assets. */
export interface PriceFeed {
  usdPerUnit(asset: NativeAsset): Promise<number>;
}

/** Polygon (137) pays gas in POL, every other supported EVM chain in ETH. */
export function nativeAssetFor(
  chain: { family: 'evm'; chainId: EvmChainId } | { family: 'solana' },
): NativeAsset {
  if (chain.family === 'solana') return 'SOL';
  return chain.chainId === 137 ? 'POL' : 'ETH';
}

function assertPrice(asset: NativeAsset, price: unknown): number {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price >= 1e9) {
    throw new GasSponsorError('price_unavailable', `No valid USD price for ${asset}`);
  }
  return price;
}

/** Fixed prices, for tests and local development. */
export function createStaticPriceFeed(prices: Record<NativeAsset, number>): PriceFeed {
  for (const asset of NATIVE_ASSETS) assertPrice(asset, prices[asset]);
  const frozen = { ...prices };
  return {
    async usdPerUnit(asset) {
      return assertPrice(asset, frozen[asset]);
    },
  };
}

const COINGECKO_IDS: Record<NativeAsset, string> = {
  ETH: 'ethereum',
  SOL: 'solana',
  POL: 'polygon-ecosystem-token',
};

const COINGECKO_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${NATIVE_ASSETS.map(
  (asset) => COINGECKO_IDS[asset],
).join(',')}&vs_currencies=usd`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * CoinGecko public `simple/price` endpoint. One request fetches all three assets,
 * kept in memory for `cacheSeconds` (default 60). Concurrent callers share the
 * in-flight request. Any failure raises `price_unavailable`, nothing stale is served.
 */
export function createCoinGeckoPriceFeed(
  options: { fetch?: typeof fetch; cacheSeconds?: number } = {},
): PriceFeed {
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  const ttlMs = (options.cacheSeconds ?? 60) * 1000;
  let cache: { prices: Record<NativeAsset, number>; expiresAt: number } | null = null;
  let inflight: Promise<Record<NativeAsset, number>> | null = null;

  async function load(): Promise<Record<NativeAsset, number>> {
    let res: Response;
    try {
      res = await fetchImpl(COINGECKO_URL, { headers: { accept: 'application/json' } });
    } catch (cause) {
      throw new GasSponsorError('price_unavailable', 'Price feed request failed', { cause });
    }
    if (!res.ok) {
      throw new GasSponsorError('price_unavailable', `Price feed answered ${res.status}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (cause) {
      throw new GasSponsorError('price_unavailable', 'Price feed returned invalid JSON', {
        cause,
      });
    }
    if (!isRecord(body)) {
      throw new GasSponsorError('price_unavailable', 'Price feed returned an unexpected body');
    }
    const prices = {} as Record<NativeAsset, number>;
    for (const asset of NATIVE_ASSETS) {
      const entry = body[COINGECKO_IDS[asset]];
      prices[asset] = assertPrice(asset, isRecord(entry) ? entry.usd : undefined);
    }
    return prices;
  }

  async function current(): Promise<Record<NativeAsset, number>> {
    if (cache && cache.expiresAt > Date.now()) return cache.prices;
    inflight ??= load()
      .then((prices) => {
        cache = { prices, expiresAt: Date.now() + ttlMs };
        return prices;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    async usdPerUnit(asset) {
      const prices = await current();
      return prices[asset];
    },
  };
}

const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

/** Exact decimal expansion of a non-negative double, rounded to 12 decimals, times 10^12. */
function toScaled(value: number): bigint {
  const [whole = '0', fraction = ''] = value.toFixed(SCALE_DIGITS).split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, '0'));
}

/**
 * Cost in the smallest unit (wei, lamports) to cents charged to the app balance:
 * `ceil(amount / 10^decimals * usdPerUnit * (1 + margin) * 100)`, at least 1 cent
 * when `amount > 0`. Integer math until the end, so wei never loses precision.
 */
export function chargedCents(input: {
  amount: bigint;
  decimals: 9 | 18;
  usdPerUnit: number;
  margin?: number;
}): number {
  const margin = input.margin ?? SPONSOR_MARGIN;
  if (input.amount < 0n) {
    throw new GasSponsorError('invalid_input', 'Amount must not be negative');
  }
  if (!Number.isFinite(input.usdPerUnit) || input.usdPerUnit <= 0 || input.usdPerUnit >= 1e9) {
    throw new GasSponsorError('invalid_input', 'USD price must be a positive finite number');
  }
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) {
    throw new GasSponsorError('invalid_input', 'Margin must be a finite number >= 0');
  }
  if (input.amount === 0n) return 0;

  const numerator = input.amount * toScaled(input.usdPerUnit) * (SCALE + toScaled(margin)) * 100n;
  const denominator = 10n ** BigInt(input.decimals) * SCALE * SCALE;
  let cents = (numerator + denominator - 1n) / denominator;
  if (cents < 1n) cents = 1n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GasSponsorError('invalid_input', 'Charged amount exceeds the safe integer range');
  }
  return Number(cents);
}
