import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { z } from 'zod';
import { PocketkeyError } from './errors.js';

/* Shape checks on what Better Auth hands out, typed as SimpleWebAuthn expects. */

const CreationOptionsShape = z.looseObject({
  challenge: z.string().min(1),
  rp: z.looseObject({ name: z.string() }),
  user: z.looseObject({ id: z.string().min(1), name: z.string() }),
  pubKeyCredParams: z.array(z.looseObject({ alg: z.number(), type: z.literal('public-key') })),
});

const RequestOptionsShape = z.looseObject({
  challenge: z.string().min(1),
});

export const RegistrationOptions = z.custom<PublicKeyCredentialCreationOptionsJSON>(
  (value) => CreationOptionsShape.safeParse(value).success,
  'Expected WebAuthn registration options',
);

export const AuthenticationOptions = z.custom<PublicKeyCredentialRequestOptionsJSON>(
  (value) => RequestOptionsShape.safeParse(value).success,
  'Expected WebAuthn authentication options',
);

/** Better Auth answers the stored passkey; only its id matters here. */
export const RegisteredPasskey = z.looseObject({ id: z.string() });

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
