import { z } from 'zod';
import type { PocketkeyClient } from './client.js';
import { PUBLIC_RPC_URLS } from './config.js';
import { hexToDecimalString, isHex, toHexQuantity } from './encoding.js';
import { PocketkeyEmbedError, ProviderRpcError } from './errors.js';

export interface EIP1193RequestArguments {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

export interface EIP1193Provider {
  request(args: EIP1193RequestArguments): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface PocketkeyEIP1193Provider extends EIP1193Provider {
  readonly isPocketkey: true;
}

/** Protocol error codes to EIP-1193 / EIP-1474 codes. */
const RPC_CODE_BY_EMBED_CODE: Partial<Record<string, number>> = {
  user_rejected: 4001,
  not_authenticated: 4100,
  wallet_not_found: 4100,
  unsupported: 4200,
  not_ready: 4900,
  chain_not_configured: 4902,
  invalid_message: -32602,
};

/** Wallet methods we do not implement. They must never be forwarded to a public RPC. */
const UNSUPPORTED_METHODS = new Set([
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'personal_ecRecover',
  'eth_decrypt',
  'eth_getEncryptionPublicKey',
]);

export function toProviderRpcError(error: unknown): ProviderRpcError {
  if (error instanceof ProviderRpcError) return error;
  if (error instanceof PocketkeyEmbedError) {
    return new ProviderRpcError(RPC_CODE_BY_EMBED_CODE[error.code] ?? -32603, error.message, {
      code: error.code,
    });
  }
  return new ProviderRpcError(-32603, error instanceof Error ? error.message : 'Internal error');
}

const invalidParams = (message: string) => new ProviderRpcError(-32602, message);
const unauthorized = () =>
  new ProviderRpcError(4100, 'The requested account has not been authorized by the user.');

const HexQuantity = z.string().regex(/^0x[0-9a-fA-F]+$/);
const ChainIdParam = z.union([HexQuantity, z.number().int().positive()]);

const SwitchChainParams = z.tuple([z.object({ chainId: ChainIdParam })]).rest(z.unknown());

const TypedDataPayload = z.object({
  domain: z.record(z.string(), z.unknown()).default({}),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});

const RpcTransaction = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  value: HexQuantity.optional(),
  data: z.string().optional(),
  input: z.string().optional(),
  gas: HexQuantity.optional(),
  gasLimit: HexQuantity.optional(),
  maxFeePerGas: HexQuantity.optional(),
  maxPriorityFeePerGas: HexQuantity.optional(),
  nonce: z.union([HexQuantity, z.number().int().nonnegative()]).optional(),
  chainId: ChainIdParam.optional(),
});

const JsonRpcResponse = z.object({
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional(),
});

const toNumber = (value: string | number): number =>
  typeof value === 'number' ? value : Number(BigInt(value));

function parseChainIdLoose(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) return Number(BigInt(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

export function createEvmProvider(client: PocketkeyClient): PocketkeyEIP1193Provider {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let rpcId = 0;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(...args);
      } catch (error) {
        console.error(error);
      }
    }
  };

  const currentAddress = (): `0x${string}` | null => {
    const address = client.getWallet('evm')?.address;
    return isHex(address) ? address : null;
  };

  const readState = () => ({
    authenticated: client.getSnapshot().user !== null,
    address: currentAddress(),
    chainId: client.getChainId(),
  });

  let last = readState();
  client.subscribe(() => {
    const next = readState();
    if (!last.authenticated && next.authenticated) {
      emit('connect', { chainId: toHexQuantity(next.chainId) });
    }
    if (last.address !== next.address) {
      emit('accountsChanged', next.address ? [next.address] : []);
    }
    if (last.chainId !== next.chainId) emit('chainChanged', toHexQuantity(next.chainId));
    if (last.authenticated && !next.authenticated) {
      emit('disconnect', new ProviderRpcError(4900, 'The user logged out.'));
    }
    last = next;
  });

  const requireAccount = (requested: unknown): `0x${string}` => {
    const address = currentAddress();
    if (!address) throw unauthorized();
    if (typeof requested !== 'string' || requested.toLowerCase() !== address.toLowerCase()) {
      throw unauthorized();
    }
    return address;
  };

  const forwardToRpc = async (args: EIP1193RequestArguments): Promise<unknown> => {
    const chainId = client.getChainId();
    const url = client.config?.rpcUrls?.[chainId] ?? PUBLIC_RPC_URLS[chainId];
    if (!url) throw new ProviderRpcError(4901, `No RPC URL configured for chain ${chainId}.`);
    rpcId += 1;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          method: args.method,
          params: args.params ?? [],
        }),
      });
    } catch (error) {
      throw new ProviderRpcError(
        -32603,
        `RPC request failed: ${error instanceof Error ? error.message : 'network error'}`,
      );
    }
    const json: unknown = await response.json().catch(() => null);
    const body = JsonRpcResponse.safeParse(json);
    if (!body.success) {
      throw new ProviderRpcError(-32603, `Invalid RPC response (HTTP ${response.status}).`);
    }
    if (body.data.error) {
      const { code, message, data } = body.data.error;
      throw new ProviderRpcError(code, message, data);
    }
    return body.data.result ?? null;
  };

  const handle = async (args: EIP1193RequestArguments): Promise<unknown> => {
    const params = Array.isArray(args.params) ? args.params : [];

    switch (args.method) {
      case 'eth_accounts': {
        const address = currentAddress();
        return address ? [address] : [];
      }

      case 'eth_requestAccounts': {
        if (!client.getSnapshot().user) await client.login();
        if (!client.getWallet('evm')) await client.createWallet('evm');
        const address = currentAddress();
        if (!address) throw unauthorized();
        return [address];
      }

      case 'eth_coinbase':
        return currentAddress();

      case 'eth_chainId':
        return toHexQuantity(client.getChainId());

      case 'net_version':
        return String(client.getChainId());

      case 'wallet_switchEthereumChain': {
        const parsed = SwitchChainParams.safeParse(params);
        if (!parsed.success) throw invalidParams('Expected [{ chainId }].');
        const chainId = toNumber(parsed.data[0].chainId);
        if (!client.getEvmChains().includes(chainId)) {
          throw new ProviderRpcError(4902, `Unrecognized chain ID ${toHexQuantity(chainId)}.`);
        }
        await client.switchChain(chainId);
        return null;
      }

      case 'wallet_addEthereumChain': {
        const parsed = SwitchChainParams.safeParse(params);
        if (!parsed.success) throw invalidParams('Expected [{ chainId, ... }].');
        if (client.getEvmChains().includes(toNumber(parsed.data[0].chainId))) return null;
        throw new ProviderRpcError(4200, 'Adding chains is not supported by Pocketkey.');
      }

      case 'personal_sign': {
        const [data, address] = params;
        requireAccount(address);
        if (typeof data !== 'string') throw invalidParams('Expected [data, address].');
        const message = isHex(data) ? { raw: data } : data;
        const { signature } = await client.signMessage({ chain: 'evm', message });
        return signature;
      }

      case 'eth_signTypedData_v4': {
        const [address, raw] = params;
        requireAccount(address);
        let candidate: unknown = raw;
        if (typeof raw === 'string') {
          try {
            candidate = JSON.parse(raw);
          } catch {
            throw invalidParams('Typed data is not valid JSON.');
          }
        }
        const parsed = TypedDataPayload.safeParse(candidate);
        if (!parsed.success) throw invalidParams('Expected EIP-712 typed data.');
        const { domain, types, primaryType, message } = parsed.data;
        const { EIP712Domain: _domainType, ...messageTypes } = types;
        const chainId = parseChainIdLoose(domain.chainId);
        const { signature } = await client.signTypedData({
          chain: 'evm',
          domain: {
            ...(typeof domain.name === 'string' ? { name: domain.name } : {}),
            ...(typeof domain.version === 'string' ? { version: domain.version } : {}),
            ...(chainId !== undefined ? { chainId } : {}),
            ...(typeof domain.verifyingContract === 'string'
              ? { verifyingContract: domain.verifyingContract }
              : {}),
            ...(typeof domain.salt === 'string' ? { salt: domain.salt } : {}),
          },
          types: messageTypes,
          primaryType,
          message,
        });
        return signature;
      }

      case 'eth_sendTransaction':
      case 'eth_signTransaction': {
        const parsed = RpcTransaction.safeParse(params[0]);
        if (!parsed.success) throw invalidParams('Invalid transaction object.');
        const tx = parsed.data;
        if (!currentAddress()) throw unauthorized();
        if (tx.from !== undefined) requireAccount(tx.from);
        if (tx.to === undefined) throw invalidParams('Contract deployment is not supported.');
        const chainId = client.getChainId();
        if (tx.chainId !== undefined && toNumber(tx.chainId) !== chainId) {
          throw invalidParams(
            `Transaction chainId ${toHexQuantity(toNumber(tx.chainId))} does not match the selected chain ${toHexQuantity(chainId)}.`,
          );
        }
        const gas = tx.gas ?? tx.gasLimit;
        const data = tx.data ?? tx.input;
        const request = {
          chain: 'evm' as const,
          chainId,
          to: tx.to,
          ...(tx.value !== undefined ? { value: hexToDecimalString(tx.value) } : {}),
          ...(data !== undefined ? { data } : {}),
          ...(gas !== undefined ? { gas: hexToDecimalString(gas) } : {}),
          ...(tx.maxFeePerGas !== undefined
            ? { maxFeePerGas: hexToDecimalString(tx.maxFeePerGas) }
            : {}),
          ...(tx.maxPriorityFeePerGas !== undefined
            ? { maxPriorityFeePerGas: hexToDecimalString(tx.maxPriorityFeePerGas) }
            : {}),
          ...(tx.nonce !== undefined ? { nonce: toNumber(tx.nonce) } : {}),
        };
        if (args.method === 'eth_signTransaction') {
          const { signedTransaction } = await client.signTransaction(request);
          return signedTransaction;
        }
        const { hash } = await client.sendTransaction(request);
        return hash;
      }

      default: {
        if (UNSUPPORTED_METHODS.has(args.method) || args.method.startsWith('wallet_')) {
          throw new ProviderRpcError(4200, `Method ${args.method} is not supported by Pocketkey.`);
        }
        return forwardToRpc(args);
      }
    }
  };

  return {
    isPocketkey: true,
    async request(args) {
      try {
        return await handle(args);
      } catch (error) {
        throw toProviderRpcError(error);
      }
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
}
