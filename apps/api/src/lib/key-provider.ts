import type { KeyProvider } from '@pocketkey/key-provider';
import { createMockKeyProvider } from '@pocketkey/key-provider/mock';
import type { ParsedEnv } from '../env.js';

// One instance per isolate. The mock keeps state in memory, which is exactly
// what local dev needs (wallets survive across requests until the Worker restarts).
let cached: KeyProvider | undefined;

export function getKeyProvider(config: ParsedEnv): KeyProvider {
  if (cached) return cached;
  switch (config.KEY_PROVIDER) {
    case 'mock':
      cached = createMockKeyProvider();
      return cached;
    case 'turnkey':
      // T0.5 wires packages/key-provider/src/turnkey here.
      throw new Error('Turnkey key provider is not implemented yet (T0.5)');
  }
}

/** Test helper. */
export function resetKeyProvider(): void {
  cached = undefined;
}
