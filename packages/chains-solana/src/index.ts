/**
 * @pocketkey/chains-solana
 *
 * Solana adapter with a dependency-free wire codec (legacy and v0 transactions).
 * Private keys never exist here: every signature is produced by a `SignBytes`
 * callback supplied by the caller. Runtime dependencies are limited to
 * @noble/curves, @scure/base and `fetch`.
 */
export { SolanaTransactionError } from './errors.js';
export {
  decodeTransaction,
  signMessage,
  signTransaction,
  transactionId,
  type DecodedTransaction,
  type SignBytes,
} from './transaction.js';
export { createSolanaRpc, type SolanaRpc } from './rpc.js';
export { buildSiwsMessage, verifySiwsLogin } from './siws.js';
export {
  COMPUTE_BUDGET_PROGRAM_ID,
  computeBudget,
  estimateFeeLamports,
  inspectTransaction,
  LAMPORTS_PER_SIGNATURE,
  programIds,
  SYSTEM_PROGRAM_ID,
  systemTransferLamportsFrom,
  type InspectedInstruction,
  type InspectedTransaction,
} from './inspect.js';
