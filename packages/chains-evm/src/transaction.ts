import {
  createPublicClient,
  getAddress,
  http,
  isHex,
  keccak256,
  parseSignature,
  parseTransaction,
  serializeTransaction,
  type Address,
  type Hex,
  type TransactionSerializableEIP1559,
} from 'viem';
import type { EvmChainId, EvmTransactionRequest } from '@pockey/types';
import { EVM_VIEM_CHAINS } from './chains.js';
import { normalizeSignature, type SignHash } from './signing.js';

/** A fully specified EIP-1559 transaction, ready to be hashed and signed. */
export interface PreparedEvmTransaction {
  chainId: EvmChainId;
  to: Address;
  value: bigint;
  data: Hex;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

function toSerializable(tx: PreparedEvmTransaction): TransactionSerializableEIP1559 {
  return {
    type: 'eip1559',
    chainId: tx.chainId,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    nonce: tx.nonce,
    gas: tx.gas,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  };
}

/** keccak256 of the unsigned EIP-1559 serialization. This is the digest the key signs. */
export function transactionSigningHash(tx: PreparedEvmTransaction): Hex {
  return keccak256(serializeTransaction(toSerializable(tx)));
}

/** Attaches a 65-byte `r || s || v` signature and returns the RLP-encoded signed transaction. */
export function serializeSignedTransaction(tx: PreparedEvmTransaction, signature: Hex): Hex {
  const { r, s, yParity } = parseSignature(normalizeSignature(signature));
  return serializeTransaction(toSerializable(tx), { r, s, yParity });
}

export async function signTransaction(
  tx: PreparedEvmTransaction,
  signHash: SignHash,
): Promise<Hex> {
  const signature = await signHash(transactionSigningHash(tx));
  return serializeSignedTransaction(tx, signature);
}

/** Minimal RPC surface used by the API. Mockable in tests. */
export interface EvmRpc {
  /** Pending nonce. */
  getTransactionCount(address: Address): Promise<number>;
  estimateGas(tx: { from: Address; to: Address; value: bigint; data: Hex }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  /** Returns the transaction hash. */
  sendRawTransaction(serialized: Hex): Promise<Hex>;
}

/** viem public client over HTTP. `url` undefined falls back to the chain default public RPC. */
export function createEvmRpc(options: { chainId: EvmChainId; url?: string }): EvmRpc {
  const client = createPublicClient({
    chain: EVM_VIEM_CHAINS[options.chainId],
    transport: http(options.url),
  });

  return {
    async getTransactionCount(address) {
      return client.getTransactionCount({ address, blockTag: 'pending' });
    },
    async estimateGas({ from, to, value, data }) {
      return client.estimateGas({ account: from, to, value, data });
    },
    async estimateFeesPerGas() {
      const fees = await client.estimateFeesPerGas({ type: 'eip1559' });
      return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
    },
    async sendRawTransaction(serialized) {
      return client.sendRawTransaction({ serializedTransaction: serialized });
    },
  };
}

/** Numerator and denominator of the safety margin applied to estimated gas (+20%). */
const GAS_BUFFER_NUM = 120n;
const GAS_BUFFER_DEN = 100n;

/**
 * Fills a transaction request into a signable EIP-1559 transaction.
 * Overrides present in the request are used as is. Missing values come from
 * `rpc`, and estimated gas gets a 20% buffer.
 */
export async function prepareTransaction(
  request: EvmTransactionRequest,
  from: Address,
  rpc: EvmRpc,
): Promise<PreparedEvmTransaction> {
  const to = getAddress(request.to);
  const sender = getAddress(from);
  const value = BigInt(request.value);
  if (!isHex(request.data, { strict: true })) {
    throw new Error('Transaction data must be 0x-prefixed hex');
  }
  const data = request.data;

  const needFees = request.maxFeePerGas === undefined || request.maxPriorityFeePerGas === undefined;

  const [nonce, gas, fees] = await Promise.all([
    request.nonce ?? rpc.getTransactionCount(sender),
    request.gas !== undefined
      ? BigInt(request.gas)
      : rpc
          .estimateGas({ from: sender, to, value, data })
          .then((estimate) => (estimate * GAS_BUFFER_NUM) / GAS_BUFFER_DEN),
    needFees ? rpc.estimateFeesPerGas() : undefined,
  ]);

  const maxPriorityFeePerGas =
    request.maxPriorityFeePerGas !== undefined
      ? BigInt(request.maxPriorityFeePerGas)
      : (fees?.maxPriorityFeePerGas ?? 0n);

  let maxFeePerGas: bigint;
  if (request.maxFeePerGas !== undefined) {
    maxFeePerGas = BigInt(request.maxFeePerGas);
  } else {
    const estimated = fees?.maxFeePerGas ?? 0n;
    // An explicit priority fee above the estimated cap would make the tx invalid.
    maxFeePerGas = estimated < maxPriorityFeePerGas ? maxPriorityFeePerGas : estimated;
  }

  return {
    chainId: request.chainId,
    to,
    value,
    data,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

/** Unsigned EIP-1559 serialization, the payload a key provider parses to apply policies. */
export function serializeUnsignedTransaction(tx: PreparedEvmTransaction): Hex {
  return serializeTransaction(toSerializable(tx));
}

/** What a policy needs to know about an unsigned or signed EIP-1559 serialization. */
export interface ParsedEvmTransaction {
  chainId: number;
  to: Address | null;
  value: bigint;
  data: Hex;
  signed: boolean;
}

export function parseEvmTransaction(serialized: Hex): ParsedEvmTransaction {
  const parsed = parseTransaction(serialized);
  if (parsed.type !== 'eip1559') {
    throw new Error('Only EIP-1559 transactions with a chain id are supported');
  }
  return {
    chainId: parsed.chainId,
    to: parsed.to ? getAddress(parsed.to) : null,
    value: parsed.value ?? 0n,
    data: parsed.data ?? '0x',
    signed: parsed.r !== undefined && parsed.s !== undefined,
  };
}
