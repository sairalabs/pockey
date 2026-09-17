/**
 * @pocketkey/chains-evm
 *
 * EVM adapter built on viem. Private keys never exist here: every signature is
 * produced by a `SignHash` callback supplied by the caller.
 */
export { EVM_VIEM_CHAINS } from './chains.js';
export {
  hashPersonalMessage,
  hashTypedDataInput,
  normalizeSignature,
  signatureToHex,
  signPersonalMessage,
  signTypedDataInput,
  type SignHash,
} from './signing.js';
export {
  createEvmRpc,
  prepareTransaction,
  serializeSignedTransaction,
  signTransaction,
  transactionSigningHash,
  serializeUnsignedTransaction,
  parseEvmTransaction,
  type ParsedEvmTransaction,
  type EvmRpc,
  type PreparedEvmTransaction,
} from './transaction.js';
export { toPocketkeyAccount } from './account.js';
export { buildSiweMessage, verifySiweLogin } from './siwe.js';
