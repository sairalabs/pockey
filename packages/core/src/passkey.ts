import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { PocketkeyError } from './errors.js';
import type { PasskeyAttestation } from './keys.js';

/**
 * Passkey ceremonies, run locally (non-custodial since 2026-09-19): the key provider
 * verifies them, not Pocketkey. Registration adds an authenticator to the user's
 * sub-organization; login asserts over the exact login request, whose WebAuthn
 * challenge is derived from its body.
 */

/** True in browsers exposing WebAuthn. Never throws, whatever the runtime. */
export function isPasskeySupported(): boolean {
  try {
    const g = globalThis as {
      PublicKeyCredential?: unknown;
      navigator?: { credentials?: unknown };
    };
    return typeof g.PublicKeyCredential === 'function' && g.navigator?.credentials !== undefined;
  } catch {
    return false;
  }
}

function errorName(e: unknown): string | undefined {
  if (!(e instanceof Error)) return undefined;
  const cause: unknown = e.cause;
  if (e.name === 'Error' && cause instanceof Error) return cause.name;
  return e.name;
}

export function mapWebAuthnError(e: unknown): PocketkeyError {
  const name = errorName(e);
  const message = e instanceof Error ? e.message : 'Passkey ceremony failed';
  const options = { cause: e, details: { name } };
  switch (name) {
    case 'NotAllowedError':
    case 'AbortError':
      return new PocketkeyError('user_rejected', message, options);
    case 'InvalidStateError':
      return new PocketkeyError('conflict', message, options);
    case 'SecurityError':
      return new PocketkeyError('forbidden', message, options);
    case 'NotSupportedError':
      return new PocketkeyError('unsupported', message, options);
    default:
      return new PocketkeyError('internal', message, options);
  }
}

/** Loaded on demand: keeps the core importable in Workers and Node, and small. */
async function loadWebAuthn() {
  return import('@simplewebauthn/browser');
}

export async function runRegistration(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  const { startRegistration } = await loadWebAuthn();
  try {
    return await startRegistration({ optionsJSON });
  } catch (e) {
    throw mapWebAuthnError(e);
  }
}

export async function runAuthentication(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  const { startAuthentication } = await loadWebAuthn();
  try {
    return await startAuthentication({ optionsJSON });
  } catch (e) {
    throw mapWebAuthnError(e);
  }
}

const TIMEOUT_MS = 5 * 60_000;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TRANSPORTS: Record<string, string> = {
  internal: 'AUTHENTICATOR_TRANSPORT_INTERNAL',
  hybrid: 'AUTHENTICATOR_TRANSPORT_HYBRID',
  usb: 'AUTHENTICATOR_TRANSPORT_USB',
  nfc: 'AUTHENTICATOR_TRANSPORT_NFC',
  ble: 'AUTHENTICATOR_TRANSPORT_BLE',
};

/**
 * Creates a discoverable passkey bound to the embed host (`rpId`). Returns the
 * attestation and the challenge the key provider needs to verify it.
 */
export async function createPasskey(input: {
  rpId: string;
  rpName: string;
  userName: string;
  run?: typeof runRegistration;
}): Promise<{ challenge: string; attestation: PasskeyAttestation }> {
  const challenge = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const response = await (input.run ?? runRegistration)({
    challenge,
    rp: { id: input.rpId, name: input.rpName },
    user: {
      id: base64url(crypto.getRandomValues(new Uint8Array(16))),
      name: input.userName,
      displayName: input.userName,
    },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    attestation: 'none',
    timeout: TIMEOUT_MS,
  });
  return {
    challenge,
    attestation: {
      credentialId: response.id,
      clientDataJson: response.response.clientDataJSON,
      attestationObject: response.response.attestationObject,
      transports: (response.response.transports ?? []).map(
        (transport) => TRANSPORTS[transport] ?? 'AUTHENTICATOR_TRANSPORT_INTERNAL',
      ),
    },
  };
}

/** Asserts with any passkey of this host over `challenge` (discoverable credentials). */
export async function assertPasskey(input: {
  rpId: string;
  challenge: Uint8Array;
  run?: typeof runAuthentication;
}): Promise<{
  credentialId: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
}> {
  const response = await (input.run ?? runAuthentication)({
    challenge: base64url(input.challenge),
    rpId: input.rpId,
    allowCredentials: [],
    userVerification: 'preferred',
    timeout: TIMEOUT_MS,
  });
  return {
    credentialId: response.id,
    clientDataJson: response.response.clientDataJSON,
    authenticatorData: response.response.authenticatorData,
    signature: response.response.signature,
  };
}
