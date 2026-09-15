import type { Curve, SigningPolicy } from '@pocketkey/types';

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
}

export interface SignRawOutput {
  /** 65 bytes r||s||v for secp256k1, 64 bytes for ed25519. */
  signature: Uint8Array;
}

export interface CreatePolicyInput {
  subOrgId: string;
  policy: SigningPolicy;
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
