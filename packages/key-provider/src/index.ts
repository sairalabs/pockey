import type { ChainFamily, SigningPolicy } from '@pockey/types';

/**
 * Section 7.3. The port every key management vendor must implement. The domain
 * (apps/api) depends on this interface only.
 *
 * Non-custodial since 2026-09-19 (DECISIONS.md). Three kinds of authority exist:
 *
 * 1. Pockey's parent credential creates sub-organizations and runs login
 *    ceremonies. It can never sign with, export or take over an end user's keys:
 *    each login is bound to a proof the end user produced (OTP ciphertext and client
 *    signature, OIDC token whose nonce commits to the iframe key, passkey or wallet
 *    signature over the exact request).
 * 2. The end user's credential (a P-256 session key inside the iframe, a passkey or
 *    an external wallet) stamps every request touching their keys. The API relays
 *    such a request as is (`relay`) after checking it matches what the route expects.
 * 3. Pockey's signer credential only acts through policies the end user created
 *    (session signers), and as the sole owner of Pockey system wallets (fee payers).
 *
 * Do not change this interface without flagging it explicitly (CLAUDE.md).
 */

/* Shared shapes */

export interface ProviderAccount {
  /** Provider wallet id holding the account. */
  walletId: string;
  /** Checksummed 0x address (EVM) or base58 public key (Solana), as the provider returns it. */
  address: string;
}

export type ProviderAccounts = Record<ChainFamily, ProviderAccount>;

/** A request to the provider, stamped by a credential the end user holds. */
export interface StampedRequest {
  /** Provider API path, e.g. `/public/v1/submit/sign_raw_payload`. */
  path: string;
  /** Exact bytes that were stamped. */
  body: string;
  stamp: { header: string; value: string };
}

/** Signature proving the holder of the key bound to a verification token approved a use of it. */
export interface ClientSignature {
  publicKey: string;
  scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256';
  message: string;
  signature: string;
}

/** A session key registered at the provider for an end user. */
export interface ProviderSession {
  subOrgId: string;
  /** Provider user id of the end user (root user of the sub-organization). */
  userId: string;
  /** Compressed P-256 public key of the session key. */
  publicKey: string;
  expiresAt: Date;
}

/** P-256 key generated in the iframe, registered as an expiring API key. */
export interface SessionKeyParams {
  apiKeyName: string;
  /** Compressed P-256 public key, hex. */
  publicKey: string;
  /** Seconds, as the provider expects them (a string). */
  expirationSeconds: string;
}

export interface CreateSubOrganizationInput {
  /** Pockey end user id, used for naming only. */
  endUserId: string;
  root:
    | {
        /** Email OTP sign-up: the provider checks the token and the client signature. */
        kind: 'email';
        email: string;
        sessionKey: SessionKeyParams;
        verificationToken: string;
        clientSignature: ClientSignature;
      }
    | {
        /** Google or Apple: the provider verifies the OIDC token. */
        kind: 'oidc';
        providerName: 'google' | 'apple';
        oidcToken: string;
      }
    | {
        /** External wallet: its key becomes the root credential. */
        kind: 'wallet';
        chainFamily: ChainFamily;
        /** Compressed secp256k1 (EVM) or raw ed25519 (Solana) public key, hex. */
        publicKey: string;
        /**
         * Session key the wallet approved by signing the login request that carries it.
         * Registered next to the wallet key, so sign-up needs a single wallet prompt.
         */
        sessionKey?: SessionKeyParams;
      };
}

export interface CreateSubOrganizationOutput {
  subOrgId: string;
  rootUserId: string;
  accounts: ProviderAccounts;
}

/* What a relayed request must be, per route. The provider parses its own wire
   format and refuses anything else, so the API never interprets provider bodies. */

export type RelayExpectation =
  | {
      kind: 'signRaw';
      subOrgId: string;
      address: string;
      /** `hash`: 32-byte digest signed as is (EVM). `raw`: message bytes (Solana). */
      encoding: 'hash' | 'raw';
      payload: Uint8Array;
    }
  | {
      kind: 'signTransaction';
      subOrgId: string;
      address: string;
      chainFamily: ChainFamily;
      /** EVM: 0x unsigned serialization. Solana: base64 transaction. */
      unsignedTransaction: string;
    }
  | { kind: 'exportAccount'; subOrgId: string; address: string }
  | { kind: 'createSigner'; subOrgId: string }
  | { kind: 'grantRevoke'; subOrgId: string; signerUserId: string }
  | {
      kind: 'createSessionPolicy';
      subOrgId: string;
      policyName: string;
      policy: SigningPolicy;
      walletId: string;
      address: string;
      signerUserId: string;
      expiresAt: Date;
    }
  | { kind: 'addPasskey'; subOrgId: string; userId: string }
  | {
      /**
       * Login ceremony. Addressed to the user's sub-organization when known (wallets),
       * or to the parent, where the provider finds the sub-organization of the
       * credential (passkeys, whose credentials are unique per registration).
       */
      kind: 'login';
      subOrgId?: string;
    };

export interface RelayResults {
  signRaw: { signature: Uint8Array };
  signTransaction: { signedTransaction: string };
  exportAccount: { exportBundle: string };
  createSigner: { signerUserId: string };
  grantRevoke: { policyId: string };
  createSessionPolicy: { policyId: string };
  addPasskey: { credentialId: string };
  login: ProviderSession;
}

/** Who stamped a request, checked before relaying it (wallet sign-up). */
export type StampIdentity =
  | { scheme: 'p256'; publicKey: string }
  | { scheme: 'secp256k1'; publicKey: string }
  | { scheme: 'ed25519'; publicKey: string }
  | { scheme: 'webauthn'; credentialId: string };

/* Signer credential operations */

export type SignerScope =
  | {
      /** Session signer: allowed only by the user's policy. */
      kind: 'session';
      policyId: string;
      /** Policies are visible about a second after creation: retry denials until then. */
      policyCreatedAt: Date;
    }
  | { kind: 'system' };

export interface SignRawInput {
  subOrgId: string;
  address: string;
  payload: Uint8Array;
  /**
   * `hash`: payload is already a 32-byte digest (EVM), sign it as is.
   * `raw`: payload is the message bytes (Solana ed25519 signs raw bytes).
   */
  encoding: 'hash' | 'raw';
  scope: SignerScope;
}

export interface SignRawOutput {
  /** 65 bytes r||s||v (v in {27, 28}) for secp256k1, 64 bytes for ed25519. */
  signature: Uint8Array;
}

export interface SignTransactionInput {
  subOrgId: string;
  address: string;
  chainFamily: ChainFamily;
  /** EVM: 0x unsigned EIP-1559 serialization. Solana: base64 transaction, other signatures kept. */
  unsignedTransaction: string;
  scope: SignerScope;
}

export interface SignTransactionOutput {
  /** EVM: 0x signed serialization. Solana: base64 transaction with this signature added. */
  signedTransaction: string;
}

/** Public facts the iframe needs to build requests. */
export interface KeyProviderInfo {
  kind: 'turnkey' | 'emulator';
  /** Parent organization id, target of login ceremonies. */
  organizationId: string;
  /** Compressed P-256 public key of the Pockey signer credential. */
  signerPublicKey: string;
  /**
   * Emulator only: the key its fake enclave signs bundles with. Production iframe
   * builds ignore it and pin Turnkey's production key.
   */
  enclaveSignerPublicKey?: string;
}

export interface KeyProvider {
  info(): KeyProviderInfo;

  /* Parent credential */
  startEmailOtp(input: {
    email: string;
    appName: string;
    logoUrl?: string;
  }): Promise<{ otpId: string; encryptionTargetBundle: string }>;
  verifyEmailOtp(input: {
    otpId: string;
    encryptedOtpBundle: string;
  }): Promise<{ verificationToken: string }>;
  createSubOrganization(input: CreateSubOrganizationInput): Promise<CreateSubOrganizationOutput>;
  otpLogin(input: {
    subOrgId: string;
    verificationToken: string;
    publicKey: string;
    clientSignature: ClientSignature;
    expirationSeconds: number;
  }): Promise<ProviderSession>;
  oauthLogin(input: {
    subOrgId: string;
    oidcToken: string;
    publicKey: string;
    expirationSeconds: number;
  }): Promise<ProviderSession>;

  /* End user credential */
  /** Verifies a stamp without sending anything. Null when it does not verify. */
  inspectStamp(request: StampedRequest): StampIdentity | null;
  /** Reads a login request: target organization and the session key it registers. */
  readLoginRequest(
    request: StampedRequest,
  ): { organizationId: string; publicKey: string; expirationSeconds: number } | null;
  relay<K extends RelayExpectation['kind']>(
    request: StampedRequest,
    expectation: Extract<RelayExpectation, { kind: K }>,
  ): Promise<RelayResults[K]>;

  /* Pockey signer credential */
  signRaw(input: SignRawInput): Promise<SignRawOutput>;
  signTransaction(input: SignTransactionInput): Promise<SignTransactionOutput>;
  deletePolicy(input: { subOrgId: string; policyId: string }): Promise<void>;
  /** Sub-organization owned by the signer credential only (fee payers). */
  createSystemAccount(input: {
    name: string;
    chainFamily: ChainFamily;
  }): Promise<{ subOrgId: string; account: ProviderAccount }>;
}

export class KeyProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'not_found'
      | 'invalid_input'
      | 'policy_denied'
      /** The stamping credential is unknown or expired (end user session gone). */
      | 'unauthenticated'
      /** The relayed request is not the one this route expects. */
      | 'unexpected_request'
      | 'provider_unavailable'
      | 'unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'KeyProviderError';
  }
}
