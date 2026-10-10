import {
  normalizeSignature,
  type SerializedUserOperation,
  type SignHash,
} from '@pockey/chains-evm';
import { EVM_CHAINS, type EvmChainId } from '@pockey/types';
import { BaseError, isAddress, isHex, type Address, type Hex } from 'viem';
import { GasSponsorError } from './errors.js';

/**
 * EVM sponsoring (T4.5): ERC-4337 user operations from a Kernel smart account
 * owned by the embedded EOA, paid by a bundler paymaster. Every network client
 * lives behind `EvmSponsorClientsFactory`, so this module is testable offline.
 */

export interface EvmCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/** The embedded wallet EOA that owns the Kernel account. */
export interface EvmOwner {
  address: Address;
}

/** An owner that can sign right away (session signers). */
export interface EvmSigningOwner extends EvmOwner {
  signHash: SignHash;
}

/**
 * A sponsored user operation, not yet signed. Serializable, so the owner can sign
 * it in another request (the embed iframe signs `digest` after checking it).
 */
export interface PreparedUserOperation {
  sender: Address;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  maxFeePerGas: bigint;
  userOperation: SerializedUserOperation;
  userOpHash: Hex;
  /** EIP-191 hash of `userOpHash`: what the Kernel v3 owner signs. */
  digest: Hex;
}

export interface UserOperationReceiptSummary {
  transactionHash: Hex;
  actualGasCost: bigint;
  success: boolean;
}

/** Network boundary of the EVM sponsor. The real one is `createPimlicoClientsFactory`. */
export interface EvmSponsorClientsFactory {
  getSmartAccountAddress(input: { chainId: EvmChainId; owner: EvmOwner }): Promise<Address>;
  prepareUserOperation(input: {
    chainId: EvmChainId;
    owner: EvmOwner;
    calls: readonly EvmCall[];
  }): Promise<PreparedUserOperation>;
  /** Submits a prepared operation with the owner signature, as is. Returns the user operation hash. */
  sendUserOperation(input: {
    chainId: EvmChainId;
    userOperation: SerializedUserOperation;
    signature: Hex;
  }): Promise<Hex>;
  waitForUserOperationReceipt(input: {
    chainId: EvmChainId;
    userOpHash: Hex;
    timeoutMs: number;
  }): Promise<UserOperationReceiptSummary>;
}

export interface EvmGasSponsor {
  getSmartAccountAddress(input: { chainId: EvmChainId; owner: EvmOwner }): Promise<Address>;
  sendUserOperation(input: {
    chainId: EvmChainId;
    owner: EvmSigningOwner;
    calls: EvmCall[];
  }): Promise<{ userOpHash: Hex; smartAccountAddress: Address; maxGasCostWei: bigint }>;
  waitForReceipt(input: {
    chainId: EvmChainId;
    userOpHash: Hex;
    timeoutMs?: number;
  }): Promise<{ transactionHash: Hex; actualGasCostWei: bigint; success: boolean }>;
}

export const DEFAULT_RECEIPT_TIMEOUT_MS = 60_000;

/** Upper bound the paymaster can be charged for a prepared operation, in wei. */
export function maxGasCostWei(
  op: Pick<
    PreparedUserOperation,
    | 'callGasLimit'
    | 'verificationGasLimit'
    | 'preVerificationGas'
    | 'paymasterVerificationGasLimit'
    | 'paymasterPostOpGasLimit'
    | 'maxFeePerGas'
  >,
): bigint {
  return (
    (op.callGasLimit +
      op.verificationGasLimit +
      op.preVerificationGas +
      op.paymasterVerificationGasLimit +
      op.paymasterPostOpGasLimit) *
    op.maxFeePerGas
  );
}

/** Removes API keys from URLs that transport errors may quote. */
export function redactSecrets(text: string): string {
  return text.replace(/(apikey=)[^&\s"']+/gi, '$1***');
}

function rpcMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const root = error.walk();
    if (root instanceof BaseError) return root.details || root.shortMessage;
    if (root instanceof Error) return root.message;
    return error.details || error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function wrap<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GasSponsorError) throw error;
    const message = redactSecrets(rpcMessage(error));
    throw new GasSponsorError('bundler_error', `${action} failed: ${message}`, {
      details: { rpcMessage: message },
    });
  }
}

function assertChain(chainId: EvmChainId): void {
  if (!Object.hasOwn(EVM_CHAINS, chainId)) {
    throw new GasSponsorError('invalid_input', `Unsupported EVM chain ${String(chainId)}`);
  }
}

function assertOwner(owner: EvmOwner): void {
  if (!isAddress(owner.address, { strict: false })) {
    throw new GasSponsorError('invalid_input', 'Owner address is not a valid EVM address');
  }
}

function normalizeCalls(calls: EvmCall[]): EvmCall[] {
  if (calls.length === 0) {
    throw new GasSponsorError('invalid_input', 'At least one call is required');
  }
  return calls.map((call, index) => {
    if (!isAddress(call.to, { strict: false })) {
      throw new GasSponsorError('invalid_input', `Call ${index} has an invalid "to" address`);
    }
    if (typeof call.value !== 'bigint' || call.value < 0n) {
      throw new GasSponsorError('invalid_input', `Call ${index} value must be a bigint >= 0`);
    }
    if (!isHex(call.data, { strict: true })) {
      throw new GasSponsorError('invalid_input', `Call ${index} data must be 0x-prefixed hex`);
    }
    return { to: call.to, value: call.value, data: call.data };
  });
}

/** Sponsor logic over any clients factory (tests inject a fake one). */
export function createEvmGasSponsor(clients: EvmSponsorClientsFactory): EvmGasSponsor {
  return {
    async getSmartAccountAddress({ chainId, owner }) {
      assertChain(chainId);
      assertOwner(owner);
      return wrap('Smart account address lookup', () =>
        clients.getSmartAccountAddress({ chainId, owner }),
      );
    },

    async sendUserOperation({ chainId, owner, calls }) {
      assertChain(chainId);
      assertOwner(owner);
      const normalized = normalizeCalls(calls);
      const prepared = await wrap('User operation preparation', () =>
        clients.prepareUserOperation({ chainId, owner, calls: normalized }),
      );
      const cost = maxGasCostWei(prepared);
      const signature = normalizeSignature(await owner.signHash(prepared.digest));
      const userOpHash = await wrap('User operation submission', () =>
        clients.sendUserOperation({ chainId, userOperation: prepared.userOperation, signature }),
      );
      return { userOpHash, smartAccountAddress: prepared.sender, maxGasCostWei: cost };
    },

    async waitForReceipt({ chainId, userOpHash, timeoutMs }) {
      assertChain(chainId);
      if (!isHex(userOpHash, { strict: true }) || userOpHash.length !== 66) {
        throw new GasSponsorError('invalid_input', 'User operation hash must be 32 bytes of hex');
      }
      const receipt = await wrap('User operation receipt', () =>
        clients.waitForUserOperationReceipt({
          chainId,
          userOpHash,
          timeoutMs: timeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS,
        }),
      );
      return {
        transactionHash: receipt.transactionHash,
        actualGasCostWei: receipt.actualGasCost,
        success: receipt.success,
      };
    },
  };
}
