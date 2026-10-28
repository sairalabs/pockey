import { z } from 'zod';
import { ChainFamily, EvmChainId } from './chains.js';

/**
 * Non-custodial key sessions (DECISIONS.md 2026-09-19).
 *
 * The iframe holds a P-256 session key registered at the key provider and stamps
 * every request that touches the user's keys. Pockey's API relays those requests
 * after checking they match the route, and cannot change a byte of them.
 */

/** Compressed P-256 public key, lowercase hex. */
export const SessionPublicKey = z
  .string()
  .regex(/^0[23][0-9a-f]{64}$/, 'Expected a compressed P-256 public key in lowercase hex');
export type SessionPublicKey = z.infer<typeof SessionPublicKey>;

/** A key provider request stamped by a credential of the end user. */
export const StampedRequest = z.object({
  path: z.string().regex(/^\/public\/v1\/submit\/[a-z_]+$/),
  body: z.string().min(2).max(64_000),
  stamp: z.object({
    header: z.enum(['X-Stamp', 'X-Stamp-WebAuthn']),
    value: z.string().min(1).max(16_000),
  }),
});
export type StampedRequest = z.infer<typeof StampedRequest>;

export const ProviderAccount = z.object({
  walletId: z.string().min(1),
  address: z.string().min(1),
});
export type ProviderAccount = z.infer<typeof ProviderAccount>;

/** What the iframe needs to build requests for this user. Sent with every login. */
export const KeySession = z.object({
  /** Sub-organization of the end user at the key provider. */
  organizationId: z.string().min(1),
  /** Provider user id of the end user. */
  userId: z.string().min(1),
  /** Provider user holding the Pockey signer key, null before the first session signer. */
  signerUserId: z.string().nullable(),
  accounts: z.object({ evm: ProviderAccount, solana: ProviderAccount }),
});
export type KeySession = z.infer<typeof KeySession>;

/** Public facts of the key provider, part of the app config. */
export const KeyProviderFacts = z.object({
  kind: z.enum(['turnkey', 'emulator']),
  /** Parent organization: target of passkey and wallet logins. */
  organizationId: z.string().min(1),
  /** Pockey signer key, added by the user as a non-root user for session signers. */
  signerPublicKey: SessionPublicKey,
  /** Emulator only. Production iframe builds ignore it. */
  enclaveSignerPublicKey: z.string().optional(),
});
export type KeyProviderFacts = z.infer<typeof KeyProviderFacts>;

/* Email OTP. The key provider sends the code; the iframe encrypts it to the
   provider's enclave together with its session key. */

export const EmailOtpStartInput = z.object({ email: z.email().max(320) });
export type EmailOtpStartInput = z.infer<typeof EmailOtpStartInput>;

export const EmailOtpStartOutput = z.object({
  otpId: z.string().min(1).max(128),
  /** Enclave signed target key: the iframe checks the signature before encrypting to it. */
  targetBundle: z.string().min(1).max(8_000),
});
export type EmailOtpStartOutput = z.infer<typeof EmailOtpStartOutput>;

export const EmailOtpVerifyInput = z.object({
  otpId: z.string().min(1).max(128),
  encryptedOtpBundle: z.string().min(1).max(8_000),
});
export type EmailOtpVerifyInput = z.infer<typeof EmailOtpVerifyInput>;

export const EmailOtpVerifyOutput = z.object({
  /** Bound to the iframe key: only that key can sign its use. */
  verificationToken: z.string().min(1).max(8_000),
  /** Sign-up creates the sub-organization, login adds a session key to it. */
  mode: z.enum(['signup', 'login']),
});
export type EmailOtpVerifyOutput = z.infer<typeof EmailOtpVerifyOutput>;

export const ClientSignature = z.object({
  publicKey: SessionPublicKey,
  scheme: z.literal('CLIENT_SIGNATURE_SCHEME_API_P256'),
  message: z.string().min(1).max(8_000),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
});
export type ClientSignature = z.infer<typeof ClientSignature>;

export const SessionKeyParams = z.object({
  apiKeyName: z.string().regex(/^session-\d{1,16}$/),
  publicKey: SessionPublicKey,
  curveType: z.literal('API_KEY_CURVE_P256'),
  expirationSeconds: z.string().regex(/^\d{1,8}$/),
});
export type SessionKeyParams = z.infer<typeof SessionKeyParams>;

export const EmailOtpLoginInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('signup'),
    otpId: z.string().min(1).max(128),
    sessionKey: SessionKeyParams,
    clientSignature: ClientSignature,
  }),
  z.object({
    mode: z.literal('login'),
    otpId: z.string().min(1).max(128),
    publicKey: SessionPublicKey,
    clientSignature: ClientSignature,
  }),
]);
export type EmailOtpLoginInput = z.infer<typeof EmailOtpLoginInput>;

/* Passkeys and external wallets: a login request stamped by the credential itself. */

export const StampedLoginInput = z.object({ request: StampedRequest });
export type StampedLoginInput = z.infer<typeof StampedLoginInput>;

export const WalletLoginInput = z.object({
  chainFamily: ChainFamily,
  request: StampedRequest,
});
export type WalletLoginInput = z.infer<typeof WalletLoginInput>;

export const AddPasskeyInput = z.object({ request: StampedRequest });
export type AddPasskeyInput = z.infer<typeof AddPasskeyInput>;

/* OAuth: the popup starts with the session key, whose hash becomes the OIDC nonce. */

export const OAuthExchangeInput = z.object({
  code: z.string().min(16).max(128),
  publicKey: SessionPublicKey,
});
export type OAuthExchangeInput = z.infer<typeof OAuthExchangeInput>;

/* Session signers: the iframe adds the Pockey signer, then creates each policy. */

export const SignerSetupInput = z.object({
  /** Creates the signer user. */
  createSigner: StampedRequest,
});
export type SignerSetupInput = z.infer<typeof SignerSetupInput>;

export const SignerSetupOutput = z.object({ signerUserId: z.string().min(1) });
export type SignerSetupOutput = z.infer<typeof SignerSetupOutput>;

export const SignerPermissionInput = z.object({ request: StampedRequest });
export type SignerPermissionInput = z.infer<typeof SignerPermissionInput>;

/* Operations prepared by the API, signed by the iframe */

export const PreparedTransaction = z.object({
  kind: z.literal('transaction'),
  ticket: z.string().min(16).max(128),
  /** 0x unsigned EIP-1559 serialization, nonce, gas and fees filled. */
  unsignedTransaction: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
export type PreparedTransaction = z.infer<typeof PreparedTransaction>;

export const PreparedUserOperation = z.object({
  kind: z.literal('userOperation'),
  ticket: z.string().min(16).max(128),
  chainId: EvmChainId,
  entryPointAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** EntryPoint 0.7 user operation, bigints as decimal strings. */
  userOperation: z.record(z.string(), z.unknown()),
  /** Digest the owner signs: EIP-191 hash of the user operation hash. */
  digest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
export type PreparedUserOperation = z.infer<typeof PreparedUserOperation>;

export const PreparedOperation = z.discriminatedUnion('kind', [
  PreparedTransaction,
  PreparedUserOperation,
  z.object({ kind: z.literal('none') }),
]);
export type PreparedOperation = z.infer<typeof PreparedOperation>;
