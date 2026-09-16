import type { KeyProvider } from '@pocketkey/key-provider';
import { createMockKeyProvider } from '@pocketkey/key-provider/mock';
import type { ParsedEnv } from '../env.js';

// One instance per isolate. With MOCK_KEY_SEED set, mock keys are derived from
// the seed so wallets stored in D1 keep signing after a `wrangler dev` restart.
let cached: KeyProvider | undefined;

export function getKeyProvider(config: ParsedEnv): KeyProvider {
  if (cached) return cached;
  switch (config.KEY_PROVIDER) {
    case 'mock':
      cached = createMockKeyProvider(config.MOCK_KEY_SEED ? { seed: config.MOCK_KEY_SEED } : {});
      return cached;
    case 'turnkey':
      // T0.5 wires packages/key-provider/src/turnkey here once sandbox keys exist.
      throw new Error('Turnkey key provider is not implemented yet (T0.5)');
  }
}

/** Test helper. */
export function resetKeyProvider(): void {
  cached = undefined;
}
