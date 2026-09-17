import type { ChainFamily, Curve, SigningPolicy } from '@pocketkey/types';

/**
 * Section 7.3. The port every key management vendor must implement.
 * The domain (apps/api) depends on this interface only.
 *
 * Do not change this interface without flagging it explicitly (CLAUDE.md).
 */

/** How the end user proves ownership of the sub-organization at the provider. */
export type AuthCredential =
  | { type: 'email'; email: string }
  | { type: 'oauth'; provider: 'google' | 'apple'; subject: string; email?: string }
  | { type: 'passkey'; credentialId: string; publicKey: string }
  | { type: 'wallet'; chainFamily: 'evm' | 'solana'; address: string };

export interface CreateSubOrganizationInput {
  endUserId: string;
  auth: AuthCredential;
}

export interface CreateWalletInput {
  subOrgId: string;
  curve: Curve;
}

export interface CreateWalletOutput {
  walletId: string;
  /** Checksummed 0x address for secp256k1, base58 public key for ed25519. */
  address: string;
  /** Hex encoded (uncompressed secp256k1 or 32-byte ed25519). */
  publicKey: string;
}

export interface SignRawInput {
  subOrgId: string;
  walletId: string;
  payload: Uint8Array;
  /**
   * `hash`: payload is already a 32-byte digest (EVM), sign it as is.
   * `raw`: payload is the message bytes (Solana ed25519 signs raw bytes).
   */
  encoding: 'hash' | 'raw';
  /**
   * Set when signing on behalf of the user through a session signer. The provider
   * must refuse unless that policy exists, is attached to this wallet and allows
   * raw signing (section 7.4). Added 2026-09-17, see DECISIONS.md.
   */
  sessionPolicyId?: string;
}

export interface SignRawOutput {
  /** 65 bytes r||s||v for secp256k1, 64 bytes for ed25519. */
  signature: Uint8Array;
}

export interface CreatePolicyInput {
  subOrgId: string;
  /** The policy only ever applies to this wallet. Added 2026-09-17. */
  walletId: string;
  policy: SigningPolicy;
  /** Absolute expiry. The provider rejects signatures after it even if the policy was not deleted. */
  expiresAt: Date;
}

/**
 * Transaction signing where the provider parses the transaction itself, so a
 * policy can constrain chain, destination, value and programs (Turnkey only
 * evaluates `eth.tx.*` and `solana.tx.*` conditions on transaction activities,
 * never on raw payloads). Added 2026-09-17, see DECISIONS.md.
 */
export interface SignTransactionInput {
  subOrgId: string;
  walletId: string;
  chainFamily: ChainFamily;
  /** EVM: 0x unsigned EIP-1559 serialization. Solana: base64 transaction, other signatures kept. */
  unsignedTransaction: string;
  /** Set when signing through a session signer: the provider enforces this policy. */
  sessionPolicyId?: string;
}

export interface SignTransactionOutput {
  /** EVM: 0x signed serialization. Solana: base64 transaction with this wallet signature added. */
  signedTransaction: string;
}

export interface ExportWalletInput {
  subOrgId: string;
  walletId: string;
  /** Client-generated ephemeral public key. The bundle is encrypted to it. */
  targetPublicKey: string;
}

export interface KeyProvider {
  createSubOrganization(input: CreateSubOrganizationInput): Promise<{ subOrgId: string }>;
  createWallet(input: CreateWalletInput): Promise<CreateWalletOutput>;
  signRaw(input: SignRawInput): Promise<SignRawOutput>;
  signTransaction(input: SignTransactionInput): Promise<SignTransactionOutput>;
  createPolicy(input: CreatePolicyInput): Promise<{ policyId: string }>;
  deletePolicy(input: { subOrgId: string; policyId: string }): Promise<void>;
  exportWallet(input: ExportWalletInput): Promise<{ encryptedBundle: string }>;
}

export class KeyProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      'not_found' | 'invalid_input' | 'policy_denied' | 'provider_unavailable' | 'unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'KeyProviderError';
  }
}
