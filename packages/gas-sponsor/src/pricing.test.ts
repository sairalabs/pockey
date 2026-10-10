import { SPONSOR_MARGIN } from '@pockey/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GasSponsorError } from './errors.js';
import {
  chargedCents,
  createCoinGeckoPriceFeed,
  createStaticPriceFeed,
  nativeAssetFor,
} from './pricing.js';

describe('chargedCents', () => {
  it('uses SPONSOR_MARGIN by default', () => {
    expect(SPONSOR_MARGIN).toBe(0.15);
    // 1 SOL at 150.25 USD: 150.25 * 1.15 * 100 = 17278.75 -> 17279
    expect(chargedCents({ amount: 1_000_000_000n, decimals: 9, usdPerUnit: 150.25 })).toBe(17279);
  });

  it('returns 0 for a zero cost', () => {
    expect(chargedCents({ amount: 0n, decimals: 18, usdPerUnit: 3000 })).toBe(0);
  });

  it('charges at least 1 cent for 1 wei', () => {
    expect(chargedCents({ amount: 1n, decimals: 18, usdPerUnit: 3000 })).toBe(1);
  });

  it('charges at least 1 cent for a base Solana fee', () => {
    // 5000 lamports at 150 USD with margin: 0.08625 cents
    expect(chargedCents({ amount: 5000n, decimals: 9, usdPerUnit: 150 })).toBe(1);
  });

  it('rounds up exactly on the cent boundary', () => {
    // 0.01 ETH at 2000 USD, no margin: exactly 2000 cents
    expect(chargedCents({ amount: 10n ** 16n, decimals: 18, usdPerUnit: 2000, margin: 0 })).toBe(
      2000,
    );
    // one more wei tips it over
    expect(
      chargedCents({ amount: 10n ** 16n + 1n, decimals: 18, usdPerUnit: 2000, margin: 0 }),
    ).toBe(2001);
  });

  it('keeps wei precision on huge amounts', () => {
    // 123.456789012345678901 ETH * 3000 * 1.15 * 100 = 42592592.209... -> 42592593
    expect(
      chargedCents({ amount: 123_456_789_012_345_678_901n, decimals: 18, usdPerUnit: 3000 }),
    ).toBe(42_592_593);
    // 1,000,000 ETH + 1 wei at 1 USD, no margin: a float conversion would drop the wei
    const amount = 10n ** 24n + 1n;
    expect(chargedCents({ amount, decimals: 18, usdPerUnit: 1, margin: 0 })).toBe(100_000_001);
  });

  it('handles fractional prices without float drift', () => {
    // 1 POL at 0.1 USD + 20%: 0.1 * 1.2 * 100 = 12 exactly (0.1 * 1.2 is 0.12000000000000001 in float)
    expect(chargedCents({ amount: 10n ** 18n, decimals: 18, usdPerUnit: 0.1, margin: 0.2 })).toBe(
      12,
    );
  });

  it('rejects invalid inputs', () => {
    expect(() => chargedCents({ amount: -1n, decimals: 18, usdPerUnit: 1 })).toThrow(
      GasSponsorError,
    );
    expect(() => chargedCents({ amount: 1n, decimals: 18, usdPerUnit: Number.NaN })).toThrow(
      GasSponsorError,
    );
    expect(() => chargedCents({ amount: 1n, decimals: 18, usdPerUnit: 0 })).toThrow(
      GasSponsorError,
    );
    expect(() => chargedCents({ amount: 1n, decimals: 18, usdPerUnit: 1, margin: -0.1 })).toThrow(
      GasSponsorError,
    );
    expect(() => chargedCents({ amount: 10n ** 40n, decimals: 18, usdPerUnit: 1 })).toThrow(
      /safe integer/,
    );
  });
});

describe('nativeAssetFor', () => {
  it('maps chains to their gas asset', () => {
    expect(nativeAssetFor({ family: 'solana' })).toBe('SOL');
    expect(nativeAssetFor({ family: 'evm', chainId: 137 })).toBe('POL');
    expect(nativeAssetFor({ family: 'evm', chainId: 8453 })).toBe('ETH');
    expect(nativeAssetFor({ family: 'evm', chainId: 1 })).toBe('ETH');
    expect(nativeAssetFor({ family: 'evm', chainId: 42161 })).toBe('ETH');
    expect(nativeAssetFor({ family: 'evm', chainId: 84532 })).toBe('ETH');
  });
});

describe('createStaticPriceFeed', () => {
  it('returns the configured prices', async () => {
    const feed = createStaticPriceFeed({ ETH: 3000, SOL: 150, POL: 0.4 });
    await expect(feed.usdPerUnit('POL')).resolves.toBe(0.4);
  });

  it('rejects missing or invalid prices', () => {
    expect(() => createStaticPriceFeed({ ETH: 3000, SOL: -1, POL: 0.4 })).toThrow(GasSponsorError);
  });
});

describe('createCoinGeckoPriceFeed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const okBody = {
    ethereum: { usd: 3012.5 },
    solana: { usd: 151.2 },
    'polygon-ecosystem-token': { usd: 0.41 },
  };

  it('fetches every asset once and caches them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      return Response.json(okBody);
    });
    const feed = createCoinGeckoPriceFeed({ fetch: fetchMock, cacheSeconds: 30 });

    const [eth, sol] = await Promise.all([feed.usdPerUnit('ETH'), feed.usdPerUnit('SOL')]);
    expect(eth).toBe(3012.5);
    expect(sol).toBe(151.2);
    await expect(feed.usdPerUnit('POL')).resolves.toBe(0.41);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = urls[0] ?? '';
    expect(url).toContain('https://api.coingecko.com/api/v3/simple/price');
    expect(url).toContain('ids=ethereum,solana,polygon-ecosystem-token');
    expect(url).toContain('vs_currencies=usd');

    vi.setSystemTime(new Date('2026-09-17T00:00:31Z'));
    await feed.usdPerUnit('ETH');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('raises price_unavailable on HTTP errors, network errors and bad bodies', async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => new Response('rate limited', { status: 429 }),
      async () => {
        throw new TypeError('network down');
      },
      async () => new Response('not json'),
      async () => Response.json({ ethereum: { usd: 3000 } }),
      async () => Response.json({ ...okBody, solana: { usd: 'x' } }),
    ];
    for (const response of cases) {
      const feed = createCoinGeckoPriceFeed({ fetch: response });
      await expect(feed.usdPerUnit('ETH')).rejects.toMatchObject({ code: 'price_unavailable' });
    }
  });

  it('retries after a failure instead of caching it', async () => {
    let calls = 0;
    const feed = createCoinGeckoPriceFeed({
      fetch: async () => {
        calls += 1;
        return calls === 1 ? new Response('', { status: 500 }) : Response.json(okBody);
      },
    });
    await expect(feed.usdPerUnit('ETH')).rejects.toBeInstanceOf(GasSponsorError);
    await expect(feed.usdPerUnit('ETH')).resolves.toBe(3012.5);
  });
});
