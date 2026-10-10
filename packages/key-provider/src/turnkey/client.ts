import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { ChainFamily, SigningPolicy } from '@pockey/types';
import { base58, base64, base64urlnopad } from '@scure/base';
import { hashMessage, recoverPublicKey, type Hex } from 'viem';
import type { ClientSignature, StampedRequest } from '../index.js';
import { prepareActivity, type PreparedActivity } from './http.js';
import { revokePermissionPolicy, toTurnkeyPolicy } from './policy.js';
import {
  compressP256PublicKey,
  createCryptoKeyStamper,
  STAMP_HEADER,
  WEBAUTHN_STAMP_HEADER,
  type Stamper,
} from './stamp.js';
import { ACTIVITY } from './wire.js';

/**
 * Browser side of the Turnkey integration (`@pockey/key-provider/client`),
 * used by the embed iframe and by tests. Enclave crypto (OTP encryption, export
 * decryption) lives in `client-crypto.ts` because `@turnkey/crypto` does not load
 * in the Workers test pool. Everything here runs where the end user's
 * credentials live: the session key never leaves this document, OTP codes are
 * encrypted to Turnkey's enclave before reaching our API, export bundles are
 * decrypted here.
 *
 * The API rebuilds and compares every body these builders produce (`provider.ts`),
 * so both sides must stay in sync: change them together.
 */

export { createCryptoKeyStamper, type Stamper } from './stamp.js';
export * from './key-client.js';

/** Seconds a session key stays valid at the provider. Matches the refresh token. */
export const SESSION_KEY_SECONDS = 30 * 24 * 3600;

export interface SessionKeyPair {
  /** Non-extractable: storable in IndexedDB, never readable by script. */
  privateKey: CryptoKey;
  /** Compressed P-256 public key, hex. */
  publicKey: string;
}

export async function generateSessionKey(): Promise<SessionKeyPair> {
  // Workers types widen generateKey to CryptoKey | CryptoKeyPair; ECDSA always gives a pair.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: compressP256PublicKey(raw) };
}

export function sessionStamper(key: SessionKeyPair): Stamper {
  return createCryptoKeyStamper(key.privateKey, key.publicKey);
}

export async function stampRequest(
  prepared: PreparedActivity,
  stamper: Stamper,
): Promise<StampedRequest> {
  const stamp = await stamper.stamp(prepared.body);
  return { path: prepared.path, body: prepared.body, stamp };
}

/* Activity builders. `organizationId` is the end user's sub-organization. */

export function buildSignRaw(input: {
  organizationId: string;
  address: string;
  payload: Uint8Array;
  encoding: 'hash' | 'raw';
}): PreparedActivity {
  return prepareActivity(ACTIVITY.signRawPayload, input.organizationId, {
    signWith: input.address,
    payload: bytesToHex(input.payload),
    encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
    hashFunction:
      input.encoding === 'hash' ? 'HASH_FUNCTION_NO_OP' : 'HASH_FUNCTION_NOT_APPLICABLE',
  });
}

export function buildSignTransaction(input: {
  organizationId: string;
  address: string;
  chainFamily: ChainFamily;
  /** EVM: 0x unsigned serialization. Solana: base64. */
  unsignedTransaction: string;
}): PreparedActivity {
  const hex =
    input.chainFamily === 'evm'
      ? input.unsignedTransaction.replace(/^0x/i, '').toLowerCase()
      : bytesToHex(base64.decode(input.unsignedTransaction));
  return prepareActivity(ACTIVITY.signTransaction, input.organizationId, {
    signWith: input.address,
    unsignedTransaction: hex,
    type: input.chainFamily === 'evm' ? 'TRANSACTION_TYPE_ETHEREUM' : 'TRANSACTION_TYPE_SOLANA',
  });
}

export function buildExportAccount(input: {
  organizationId: string;
  address: string;
  /** Uncompressed P-256 public key, hex. */
  targetPublicKey: string;
}): PreparedActivity {
  return prepareActivity(ACTIVITY.exportWalletAccount, input.organizationId, {
    address: input.address,
    targetPublicKey: input.targetPublicKey,
  });
}

/** Adds the Pockey signer as a non-root user. It can do nothing until a policy says so. */
export function buildCreateSigner(input: {
  organizationId: string;
  signerPublicKey: string;
}): PreparedActivity {
  return prepareActivity(ACTIVITY.createUsers, input.organizationId, {
    users: [
      {
        userName: 'pockey-signer',
        apiKeys: [
          {
            apiKeyName: 'pockey',
            publicKey: input.signerPublicKey,
            curveType: 'API_KEY_CURVE_P256',
          },
        ],
        authenticators: [],
        oauthProviders: [],
        userTags: [],
      },
    ],
  });
}

export function buildGrantRevoke(input: {
  organizationId: string;
  signerUserId: string;
}): PreparedActivity {
  return prepareActivity(
    ACTIVITY.createPolicy,
    input.organizationId,
    revokePermissionPolicy(input.signerUserId),
  );
}

export function buildSessionPolicy(input: {
  organizationId: string;
  policyName: string;
  policy: SigningPolicy;
  walletId: string;
  address: string;
  signerUserId: string;
  expiresAt: Date;
}): PreparedActivity {
  return prepareActivity(
    ACTIVITY.createPolicy,
    input.organizationId,
    toTurnkeyPolicy(input.policy, {
      walletId: input.walletId,
      address: input.address,
      sessionUserId: input.signerUserId,
      policyName: input.policyName,
      expiresAt: input.expiresAt,
    }),
  );
}

export interface PasskeyAttestation {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export function buildAddPasskey(input: {
  organizationId: string;
  userId: string;
  name: string;
  /** base64url challenge that was given to `navigator.credentials.create`. */
  challenge: string;
  attestation: PasskeyAttestation;
}): PreparedActivity {
  return prepareActivity(ACTIVITY.createAuthenticators, input.organizationId, {
    userId: input.userId,
    authenticators: [
      {
        authenticatorName: input.name.slice(0, 64),
        challenge: input.challenge,
        attestation: input.attestation,
      },
    ],
  });
}

/** Login addressed to the parent organization: the provider finds the user's sub-organization. */
export function buildLogin(input: {
  parentOrganizationId: string;
  publicKey: string;
  expirationSeconds?: number;
}): PreparedActivity {
  return prepareActivity(ACTIVITY.stampLogin, input.parentOrganizationId, {
    publicKey: input.publicKey,
    expirationSeconds: String(input.expirationSeconds ?? SESSION_KEY_SECONDS),
  });
}

/* Email OTP */

/** Reads the id and bound key of a verification token (no trust needed: we only sign over it). */
export function readVerificationToken(token: string): { id: string; publicKey: string } {
  const payload = token.split('.')[1] ?? '';
  const claims = JSON.parse(
    new TextDecoder().decode(base64urlnopad.decode(payload.replace(/=+$/, ''))),
  ) as { id?: string; public_key?: string };
  if (!claims.id || !claims.public_key) throw new Error('Malformed verification token');
  return { id: claims.id, publicKey: claims.public_key };
}

async function clientSignature(key: SessionKeyPair, message: string): Promise<ClientSignature> {
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      new TextEncoder().encode(message),
    ),
  );
  return {
    publicKey: key.publicKey,
    scheme: 'CLIENT_SIGNATURE_SCHEME_API_P256',
    message,
    signature: bytesToHex(raw),
  };
}

/** Session key registration params, identical in the request and in the signed usage. */
export function sessionKeyParams(publicKey: string, now = Date.now()) {
  return {
    apiKeyName: `session-${now}`,
    publicKey,
    curveType: 'API_KEY_CURVE_P256' as const,
    expirationSeconds: String(SESSION_KEY_SECONDS),
  };
}

/** Approves creating a sub-organization whose root is this email and this session key only. */
export function signupSignature(input: {
  key: SessionKeyPair;
  verificationToken: string;
  email: string;
  sessionKey: ReturnType<typeof sessionKeyParams>;
}): Promise<ClientSignature> {
  const token = readVerificationToken(input.verificationToken);
  const message = JSON.stringify({
    signupV2: {
      apiKeys: [input.sessionKey],
      authenticators: [],
      oauthProviders: [],
      email: input.email,
    },
    tokenId: token.id,
    type: 'USAGE_TYPE_SIGNUP',
  });
  return clientSignature(input.key, message);
}

/** Approves a login that registers this session key. */
export function loginSignature(input: {
  key: SessionKeyPair;
  verificationToken: string;
}): Promise<ClientSignature> {
  const token = readVerificationToken(input.verificationToken);
  const message = JSON.stringify({
    login: { publicKey: input.key.publicKey },
    tokenId: token.id,
    type: 'USAGE_TYPE_LOGIN',
  });
  return clientSignature(input.key, message);
}

/* OAuth: the provider only accepts an OIDC token whose nonce commits to the session key. */

export function oidcNonce(publicKey: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(publicKey)));
}

/* Export (section 8.4) */

export interface ExportKey {
  /** Uncompressed P-256 public key, hex: the provider encrypts to it. */
  publicKey: string;
  /** Lives in this document's memory only, for the time of one export. */
  privateKey: string;
}

export function generateExportKey(): ExportKey {
  const secret = p256.utils.randomSecretKey();
  return {
    privateKey: bytesToHex(secret),
    publicKey: bytesToHex(p256.getPublicKey(secret, false)),
  };
}

/* External wallets as login credentials */

/** Stamp from an EVM wallet's `personal_sign` over the body (EIP-191). */
export async function evmWalletStamp(
  body: string,
  personalSign: (message: string) => Promise<Hex>,
): Promise<StampedRequest['stamp']> {
  const signature = await personalSign(body);
  const uncompressed = await recoverPublicKey({ hash: hashMessage(body), signature });
  const publicKey = compressP256Like(uncompressed);
  const der = secp256k1.Signature.fromBytes(hexToBytes(signature.slice(2, 130)), 'compact').toBytes(
    'der',
  );
  return encodeStamp({
    publicKey,
    scheme: 'SIGNATURE_SCHEME_TK_API_SECP256K1_EIP191',
    signature: bytesToHex(der),
  });
}

/** Stamp from a Solana wallet's `signMessage` over the body bytes. */
export async function solanaWalletStamp(
  body: string,
  address: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<StampedRequest['stamp']> {
  const signature = await signMessage(new TextEncoder().encode(body));
  return encodeStamp({
    publicKey: bytesToHex(base58.decode(address)),
    scheme: 'SIGNATURE_SCHEME_TK_API_ED25519',
    signature: bytesToHex(signature),
  });
}

function compressP256Like(uncompressedHex: Hex): string {
  return secp256k1.Point.fromBytes(hexToBytes(uncompressedHex.slice(2))).toHex(true);
}

function encodeStamp(json: { publicKey: string; scheme: string; signature: string }) {
  return {
    header: STAMP_HEADER,
    value: base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(json))),
  };
}

/* Passkeys */

/** WebAuthn challenge for a stamped body: UTF-8 bytes of hex(SHA-256(body)). */
export function webauthnChallenge(body: string): Uint8Array {
  return new TextEncoder().encode(bytesToHex(sha256(new TextEncoder().encode(body))));
}

export function webauthnStamp(assertion: {
  credentialId: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
}): StampedRequest['stamp'] {
  return {
    header: WEBAUTHN_STAMP_HEADER,
    value: JSON.stringify({
      authenticatorData: assertion.authenticatorData,
      clientDataJson: assertion.clientDataJson,
      credentialId: assertion.credentialId,
      signature: assertion.signature,
    }),
  };
}
