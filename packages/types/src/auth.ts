import { z } from 'zod';
import { Base64String, ChainFamily, HexString } from './chains.js';
import { KeySession } from './keys.js';
import { EndUser } from './user.js';

/**
 * Pockey session model.
 * - Access token: JWT HS256, 15 minutes, sent as `Authorization: Bearer`.
 * - Refresh token: opaque `pk_rt_...`, 30 days, rotated on every use.
 * Both live inside the embed iframe, never in the host page.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

export const RefreshToken = z
  .string()
  .regex(/^pk_rt_[A-Za-z0-9_-]{43}$/, 'Expected a refresh token like "pk_rt_..."');

export const AuthTokens = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: RefreshToken,
  refreshTokenExpiresAt: z.iso.datetime(),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

/** Every successful login returns tokens plus the user, so the SDK needs no second call. */
export const AuthResponse = AuthTokens.extend({
  user: EndUser,
  /** True when this login created the end user. */
  isNewUser: z.boolean(),
  /** Where the iframe session key acts at the key provider. */
  keySession: KeySession,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const RefreshInput = z.object({ refreshToken: RefreshToken });
export type RefreshInput = z.infer<typeof RefreshInput>;

export const LogoutOutput = z.object({ ok: z.literal(true) });
export type LogoutOutput = z.infer<typeof LogoutOutput>;

/* External wallet login: SIWE for EVM, SIWS for Solana. */

export const WalletNonceInput = z.object({ chainFamily: ChainFamily });
export type WalletNonceInput = z.infer<typeof WalletNonceInput>;

export const WalletNonceOutput = z.object({
  nonce: z.string().regex(/^[a-zA-Z0-9]{16,64}$/),
  expiresAt: z.iso.datetime(),
});
export type WalletNonceOutput = z.infer<typeof WalletNonceOutput>;

export const WalletVerifyInput = z.discriminatedUnion('chainFamily', [
  z.object({
    chainFamily: z.literal('evm'),
    /** EIP-4361 message the wallet signed. */
    message: z.string().min(1).max(4096),
    signature: HexString,
  }),
  z.object({
    chainFamily: z.literal('solana'),
    /** Sign In With Solana message the wallet signed. */
    message: z.string().min(1).max(4096),
    signature: Base64String,
    /** Base58 public key of the signer. */
    publicKey: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }),
]);
export type WalletVerifyInput = z.infer<typeof WalletVerifyInput>;

/* Device binding for email OTP. Generated once per browser inside the iframe. */
export const DEVICE_ID_HEADER = 'X-Pockey-Device';
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Expected a device id');
