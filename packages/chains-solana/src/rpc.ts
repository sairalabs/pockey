import { base64 } from '@scure/base';
import type { SolanaCluster } from '@pocketkey/types';
import { SolanaTransactionError } from './errors.js';

/** Minimal RPC surface used by the API. Mockable in tests. */
export interface SolanaRpc {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  /** Returns the transaction signature. */
  sendRawTransaction(serialized: Uint8Array): Promise<string>;
}

export const SOLANA_CLUSTER_URLS: Record<SolanaCluster, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * JSON-RPC client over `fetch`. `url` undefined falls back to the public cluster
 * endpoint. `fetch` can be injected for tests.
 */
export function createSolanaRpc(options: {
  cluster: SolanaCluster;
  url?: string;
  fetch?: typeof fetch;
}): SolanaRpc {
  const url = options.url ?? SOLANA_CLUSTER_URLS[options.cluster];
  // Wrapped so the global is never called detached (Workers throws "Illegal invocation").
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  let nextId = 0;

  async function call(method: string, params: unknown[]): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
      });
    } catch (cause) {
      throw new SolanaTransactionError(`Solana RPC ${method} request failed`, { cause });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new SolanaTransactionError(
        `Solana RPC ${method} returned a non-JSON response (HTTP ${response.status})`,
        { cause },
      );
    }
    if (!isRecord(body)) {
      throw new SolanaTransactionError(`Solana RPC ${method} returned an invalid response`);
    }
    if (isRecord(body.error)) {
      const message =
        typeof body.error.message === 'string' ? body.error.message : 'Unknown RPC error';
      throw new SolanaTransactionError(message);
    }
    if (!response.ok) {
      throw new SolanaTransactionError(`Solana RPC ${method} failed with HTTP ${response.status}`);
    }
    return body.result;
  }

  return {
    async getLatestBlockhash() {
      const result = await call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const value = isRecord(result) ? result.value : undefined;
      if (
        !isRecord(value) ||
        typeof value.blockhash !== 'string' ||
        typeof value.lastValidBlockHeight !== 'number'
      ) {
        throw new SolanaTransactionError(
          'Solana RPC getLatestBlockhash returned an invalid result',
        );
      }
      return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
    },
    async sendRawTransaction(serialized) {
      const result = await call('sendTransaction', [
        base64.encode(serialized),
        { encoding: 'base64', preflightCommitment: 'confirmed' },
      ]);
      if (typeof result !== 'string') {
        throw new SolanaTransactionError('Solana RPC sendTransaction returned an invalid result');
      }
      return result;
    },
  };
}
