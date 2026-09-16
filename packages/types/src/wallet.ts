import { z } from 'zod';
import {
  AmountString,
  Base64String,
  ChainFamily,
  EvmAddress,
  EvmChainId,
  HexString,
  SolanaAddress,
  SolanaCluster,
} from './chains.js';
import { EndUserId, WalletId } from './ids.js';

export const Wallet = z.object({
  id: WalletId,
  endUserId: EndUserId,
  chainFamily: ChainFamily,
  /** Checksummed EVM address or base58 Solana public key. */
  address: z.string(),
  /** Set only when the app enabled EVM gas sponsoring and a smart account was deployed. */
  smartAccountAddress: EvmAddress.nullable(),
  createdAt: z.iso.datetime(),
});
export type Wallet = z.infer<typeof Wallet>;

export const CreateWalletInput = z.object({
  chainFamily: ChainFamily,
});
export type CreateWalletInput = z.infer<typeof CreateWalletInput>;

/* Sign message */

export const SignMessageInput = z.discriminatedUnion('chain', [
  z.object({
    chain: z.literal('evm'),
    /** UTF-8 text or 0x-hex bytes. EIP-191 personal_sign semantics. */
    message: z.union([z.string().min(1), z.object({ raw: HexString })]),
  }),
  z.object({
    chain: z.literal('solana'),
    /** Base64 encoded bytes. */
    message: Base64String,
  }),
]);
export type SignMessageInput = z.infer<typeof SignMessageInput>;

export const SignMessageOutput = z.object({
  /** 0x-hex (EVM, 65 bytes) or base64 (Solana, 64 bytes). */
  signature: z.string(),
});
export type SignMessageOutput = z.infer<typeof SignMessageOutput>;

/* Sign typed data (EVM only) */

export const TypedDataDomain = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  chainId: z.number().int().positive().optional(),
  verifyingContract: EvmAddress.optional(),
  salt: HexString.optional(),
});

export const TypedDataField = z.object({ name: z.string(), type: z.string() });

export const SignTypedDataInput = z.object({
  chain: z.literal('evm'),
  domain: TypedDataDomain,
  types: z.record(z.string(), z.array(TypedDataField)),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});
export type SignTypedDataInput = z.infer<typeof SignTypedDataInput>;

/* Transactions */

export const EvmTransactionRequest = z.object({
  chain: z.literal('evm'),
  chainId: EvmChainId,
  to: EvmAddress,
  value: AmountString.default('0'),
  data: HexString.default('0x'),
  /** Optional overrides. When absent the API estimates. */
  gas: AmountString.optional(),
  maxFeePerGas: AmountString.optional(),
  maxPriorityFeePerGas: AmountString.optional(),
  nonce: z.number().int().nonnegative().optional(),
});
export type EvmTransactionRequest = z.infer<typeof EvmTransactionRequest>;

export const SolanaTransactionRequest = z.object({
  chain: z.literal('solana'),
  cluster: SolanaCluster,
  /** Base64 serialized transaction (legacy or v0), unsigned or partially signed. */
  transaction: Base64String,
});
export type SolanaTransactionRequest = z.infer<typeof SolanaTransactionRequest>;

export const TransactionRequest = z.discriminatedUnion('chain', [
  EvmTransactionRequest,
  SolanaTransactionRequest,
]);
export type TransactionRequest = z.infer<typeof TransactionRequest>;

export const SendTransactionInput = z.intersection(
  TransactionRequest,
  z.object({
    /** Requires gas sponsoring enabled on the app and a prepaid balance. */
    sponsored: z.boolean().default(false),
  }),
);
export type SendTransactionInput = z.infer<typeof SendTransactionInput>;

export const SignTransactionOutput = z.object({
  /** RLP-encoded signed tx (0x-hex) or base64 signed Solana tx. */
  signedTransaction: z.string(),
});
export type SignTransactionOutput = z.infer<typeof SignTransactionOutput>;

export const SendTransactionOutput = z.object({
  /** Tx hash (EVM), user operation hash (sponsored EVM) or signature (Solana). */
  hash: z.string(),
  sponsored: z.boolean(),
});
export type SendTransactionOutput = z.infer<typeof SendTransactionOutput>;

/* Export (section 8.4) */

export const ExportWalletInput = z.object({
  /**
   * Ephemeral public key generated inside the iframe (P-256, base64 SPKI).
   * The key provider encrypts the bundle to this key, our API only relays ciphertext.
   */
  targetPublicKey: Base64String,
});
export type ExportWalletInput = z.infer<typeof ExportWalletInput>;

export const ExportWalletOutput = z.object({
  encryptedBundle: z.string(),
});
export type ExportWalletOutput = z.infer<typeof ExportWalletOutput>;

/* Solana address helper types re-exported for convenience */
export { EvmAddress, SolanaAddress };

export const WalletList = z.object({ wallets: z.array(Wallet) });
export type WalletList = z.infer<typeof WalletList>;
