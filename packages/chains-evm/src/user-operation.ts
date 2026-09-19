import {
  decodeFunctionData,
  hashMessage,
  hexToBigInt,
  isAddress,
  isHex,
  parseAbi,
  sliceHex,
  type Address,
  type Hex,
} from 'viem';
import { getUserOperationHash, type UserOperation } from 'viem/account-abstraction';

/**
 * ERC-4337 (EntryPoint 0.7) helpers shared by the API, which prepares sponsored
 * user operations, and the embed iframe, which checks one before signing it.
 */

const BIGINT_FIELDS = [
  'nonce',
  'callGasLimit',
  'verificationGasLimit',
  'preVerificationGas',
  'maxFeePerGas',
  'maxPriorityFeePerGas',
  'paymasterVerificationGasLimit',
  'paymasterPostOpGasLimit',
] as const;

const HEX_FIELDS = ['callData', 'factoryData', 'paymasterData', 'signature'] as const;
const ADDRESS_FIELDS = ['sender', 'factory', 'paymaster'] as const;

/** JSON form: bigints as decimal strings, everything else as is. */
export type SerializedUserOperation = Record<string, string>;

export function serializeUserOperation(op: UserOperation<'0.7'>): SerializedUserOperation {
  const out: SerializedUserOperation = {};
  for (const [key, value] of Object.entries(op)) {
    if (typeof value === 'bigint') out[key] = value.toString();
    else if (typeof value === 'string') out[key] = value;
  }
  delete out.signature;
  return out;
}

/** Strict parse: unknown fields and malformed values are refused. */
export function deserializeUserOperation(json: Record<string, unknown>): UserOperation<'0.7'> {
  const op: Record<string, unknown> = { signature: '0x' };
  for (const [key, value] of Object.entries(json)) {
    if (typeof value !== 'string') throw new Error(`User operation field ${key} must be a string`);
    if ((BIGINT_FIELDS as readonly string[]).includes(key)) {
      if (!/^\d{1,78}$/.test(value)) throw new Error(`User operation field ${key} is not a number`);
      op[key] = BigInt(value);
    } else if ((ADDRESS_FIELDS as readonly string[]).includes(key)) {
      if (!isAddress(value, { strict: false }))
        throw new Error(`User operation field ${key} is not an address`);
      op[key] = value;
    } else if ((HEX_FIELDS as readonly string[]).includes(key)) {
      if (!isHex(value, { strict: true }))
        throw new Error(`User operation field ${key} is not hex`);
      op[key] = value;
    } else {
      throw new Error(`Unknown user operation field ${key}`);
    }
  }
  for (const required of [
    'sender',
    'nonce',
    'callData',
    'callGasLimit',
    'verificationGasLimit',
    'preVerificationGas',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
  ]) {
    if (op[required] === undefined) throw new Error(`User operation misses ${required}`);
  }
  return op as unknown as UserOperation<'0.7'>;
}

/** What the Kernel v3 owner signs: EIP-191 hash of the user operation hash. */
export function userOperationDigest(input: {
  userOperation: UserOperation<'0.7'>;
  chainId: number;
  entryPointAddress: Address;
}): { userOpHash: Hex; digest: Hex } {
  const userOpHash = getUserOperationHash({
    userOperation: { ...input.userOperation, signature: '0x' },
    entryPointAddress: input.entryPointAddress,
    entryPointVersion: '0.7',
    chainId: input.chainId,
  });
  return { userOpHash, digest: hashMessage({ raw: userOpHash }) };
}

const KERNEL_V3_ABI = parseAbi(['function execute(bytes32 execMode, bytes executionCalldata)']);

/**
 * Decodes a Kernel v3 `execute` in single call mode (`execMode` 0x00..00):
 * `executionCalldata` is `abi.encodePacked(target, value, callData)`. Batch and
 * delegate modes are refused, so what the user approves is exactly one call.
 */
export function decodeKernelExecute(callData: Hex): { to: Address; value: bigint; data: Hex } {
  const decoded = decodeFunctionData({ abi: KERNEL_V3_ABI, data: callData });
  const [execMode, executionCalldata] = decoded.args;
  if (!/^0x0{64}$/.test(execMode))
    throw new Error('Only single call Kernel executions are supported');
  if (executionCalldata.length < 2 + 2 * 52)
    throw new Error('Kernel execution calldata is too short');
  const to = sliceHex(executionCalldata, 0, 20);
  const value = hexToBigInt(sliceHex(executionCalldata, 20, 52));
  const data = executionCalldata.length > 2 + 2 * 52 ? sliceHex(executionCalldata, 52) : '0x';
  return { to, value, data };
}
