import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { keccak256, recoverAddress, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  buildSignRaw,
  sessionKeyParams,
  sessionStamper,
  signupSignature,
  stampRequest,
  type SessionKeyPair,
} from './client.js';
import { encryptOtp } from './client-crypto.js';
import { createHttpTransport, TurnkeyClient } from './http.js';
import { TurnkeyKeyProvider } from './provider.js';
import { createApiKeyStamper } from './stamp.js';
import { TURNKEY_API_BASE_URL } from './wire.js';

/**
 * Manual, two step check of the email OTP flow against the real Turnkey API: the
 * one path the emulator cannot prove, since Turnkey itself sends the code. It
 * follows exactly what the iframe does, so it pins the message formats of
 * `INIT_OTP_V3`, `VERIFY_OTP_V2`, the sign-up client signature and the session key.
 *
 * Step 1 sends the code and prints `OTP_STATE` (it holds the session key, so keep it
 * local and short lived). Run from `packages/key-provider`:
 *
 *   set -a; . ../../apps/api/.dev.vars; set +a
 *   OTP_EMAIL=you@example.com TURNKEY_LIVE=1 pnpm exec vitest run otp-live
 *
 * Step 2, with the code from the inbox:
 *
 *   OTP_STATE=... OTP_CODE=123456 TURNKEY_LIVE=1 pnpm exec vitest run otp-live
 *
 * Each run creates one sub-organization and spends one signature.
 */
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const live =
  env.TURNKEY_LIVE === '1' &&
  Boolean(env.TURNKEY_ORG_ID && env.TURNKEY_API_PUBLIC_KEY && env.TURNKEY_API_PRIVATE_KEY);

interface OtpState {
  email: string;
  secret: string;
  otpId: string;
  targetBundle: string;
}

/** Imports a hex P-256 secret as a WebCrypto key, so the flow signs like the iframe. */
async function toSessionKey(privateKeyHex: string): Promise<SessionKeyPair> {
  const secret = hexToBytes(privateKeyHex);
  const point = p256.getPublicKey(secret, false);
  const b64 = (bytes: Uint8Array) => base64urlnopad.encode(bytes);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: b64(secret),
    x: b64(point.slice(1, 33)),
    y: b64(point.slice(33, 65)),
    ext: false,
  };
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { privateKey, publicKey: bytesToHex(p256.getPublicKey(secret, true)) };
}

describe.skipIf(!live)('email OTP against real Turnkey', () => {
  const provider = live
    ? new TurnkeyKeyProvider({
        client: new TurnkeyClient({
          transport: createHttpTransport({ baseUrl: TURNKEY_API_BASE_URL }),
        }),
        kind: 'turnkey',
        parentOrgId: env.TURNKEY_ORG_ID ?? '',
        parentStamper: createApiKeyStamper({
          publicKey: env.TURNKEY_API_PUBLIC_KEY ?? '',
          privateKey: env.TURNKEY_API_PRIVATE_KEY ?? '',
        }),
      })
    : null;

  it('step 1: asks Turnkey to email a code', { timeout: 60_000 }, async () => {
    if (!provider || !env.OTP_EMAIL || env.OTP_CODE) return;
    const secret = bytesToHex(p256.utils.randomSecretKey());
    const key = await toSessionKey(secret);
    const started = await provider.startEmailOtp({ email: env.OTP_EMAIL, appName: 'Pocketkey' });
    const state: OtpState = {
      email: env.OTP_EMAIL,
      secret,
      otpId: started.otpId,
      targetBundle: started.encryptionTargetBundle,
    };
    console.info(`SENT to ${env.OTP_EMAIL}, session key ${key.publicKey}`);
    console.info(
      `OTP_STATE=${base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(state)))}`,
    );
    expect(started.encryptionTargetBundle.length).toBeGreaterThan(100);
  });

  it('step 2: encrypts the code, signs up and signs', { timeout: 120_000 }, async () => {
    if (!provider || !env.OTP_CODE || !env.OTP_STATE) return;
    const state = JSON.parse(
      new TextDecoder().decode(base64urlnopad.decode(env.OTP_STATE)),
    ) as OtpState;
    const key = await toSessionKey(state.secret);

    // The iframe checks the bundle is signed by Turnkey's production enclave, then
    // encrypts the code and its session key to it. Our API never sees the code.
    const encryptedOtpBundle = await encryptOtp({
      code: env.OTP_CODE,
      targetBundle: state.targetBundle,
      publicKey: key.publicKey,
    });
    const { verificationToken } = await provider.verifyEmailOtp({
      otpId: state.otpId,
      encryptedOtpBundle,
    });

    const sessionKey = sessionKeyParams(key.publicKey);
    const created = await provider.createSubOrganization({
      endUserId: 'usr_otp_live',
      root: {
        kind: 'email',
        email: state.email,
        sessionKey,
        verificationToken,
        clientSignature: await signupSignature({
          key,
          verificationToken,
          email: state.email,
          sessionKey,
        }),
      },
    });
    console.info('SIGNED UP', created.subOrgId, created.accounts.evm.address);

    // The session key alone can now sign for this user.
    const digest = hexToBytes(keccak256(toHex('pocketkey otp live')).slice(2));
    const request = await stampRequest(
      buildSignRaw({
        organizationId: created.subOrgId,
        address: created.accounts.evm.address,
        payload: digest,
        encoding: 'hash',
      }),
      sessionStamper(key),
    );
    const { signature } = await provider.relay(request, {
      kind: 'signRaw',
      subOrgId: created.subOrgId,
      address: created.accounts.evm.address,
      encoding: 'hash',
      payload: digest,
    });
    expect(await recoverAddress({ hash: toHex(digest), signature: toHex(signature) })).toBe(
      created.accounts.evm.address,
    );
  });
});
