import { z } from 'zod';

export const ChainFamily = z.enum(['evm', 'solana']);
export type ChainFamily = z.infer<typeof ChainFamily>;

/** Curve used by the key provider for a chain family. */
export const CURVE_BY_FAMILY = {
  evm: 'secp256k1',
  solana: 'ed25519',
} as const satisfies Record<ChainFamily, 'secp256k1' | 'ed25519'>;

export const Curve = z.enum(['secp256k1', 'ed25519']);
export type Curve = z.infer<typeof Curve>;

/** EVM chains supported at MVP (section 13, T2.1). Keyed by chainId. */
export const EVM_CHAINS = {
  1: { id: 1, name: 'Ethereum', slug: 'ethereum' },
  8453: { id: 8453, name: 'Base', slug: 'base' },
  42161: { id: 42161, name: 'Arbitrum One', slug: 'arbitrum' },
  137: { id: 137, name: 'Polygon', slug: 'polygon' },
  84532: { id: 84532, name: 'Base Sepolia', slug: 'base-sepolia', testnet: true },
  11155111: { id: 11155111, name: 'Sepolia', slug: 'sepolia', testnet: true },
} as const;

export const EvmChainId = z.union([
  z.literal(1),
  z.literal(8453),
  z.literal(42161),
  z.literal(137),
  z.literal(84532),
  z.literal(11155111),
]);
export type EvmChainId = z.infer<typeof EvmChainId>;

export const SolanaCluster = z.enum(['mainnet-beta', 'devnet']);
export type SolanaCluster = z.infer<typeof SolanaCluster>;

/** 0x-prefixed, 20-byte, hex encoded. Case-insensitive on input. */
export const EvmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Expected an EVM address')
  .brand<'EvmAddress'>();
export type EvmAddress = z.infer<typeof EvmAddress>;

/** Base58, 32 bytes. Length check only, base58 alphabet enforced. */
export const SolanaAddress = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Expected a Solana address')
  .brand<'SolanaAddress'>();
export type SolanaAddress = z.infer<typeof SolanaAddress>;

export const HexString = z.string().regex(/^0x[0-9a-fA-F]*$/, 'Expected 0x-prefixed hex');
export type HexString = z.infer<typeof HexString>;

/** Base64 (standard alphabet) payload, used for raw bytes over JSON. */
export const Base64String = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Expected base64')
  .refine((s) => s.length % 4 === 0, 'Expected base64 with correct padding');
export type Base64String = z.infer<typeof Base64String>;

/** Decimal string of an integer amount in the chain's smallest unit (wei, lamports). */
export const AmountString = z.string().regex(/^\d+$/, 'Expected a decimal integer string');
export type AmountString = z.infer<typeof AmountString>;
