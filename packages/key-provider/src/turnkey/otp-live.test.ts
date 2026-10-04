import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { SigningPolicy } from '@pocketkey/types';
import { base64urlnopad } from '@scure/base';
import {
  keccak256,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
  toHex,
  type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';
import { KeyProviderError } from '../index.js';
import {
  buildCreateSigner,
  buildGrantRevoke,
  buildSessionPolicy,
  buildSignRaw,
  loginSignature,
  sessionKeyParams,
  sessionStamper,
  signupSignature,
  stampRequest,
  type SessionKeyPair,
} from './client.js';
import { encryptOtp } from './client-crypto.js';
import { createHttpTransport, TurnkeyClient } from './http.js';
import { TurnkeyKeyProvider } from './provider.js';
import { createApiKeyStamper, generateApiKeyPair } from './stamp.js';
import { TURNKEY_API_BASE_URL } from './wire.js';

/**
 * Manual, two step check of the email OTP flow against the real Turnkey API: the
 * one path the emulator cannot prove, since Turnkey itself sends the code. It
 * follows exactly what the iframe does, so it pins the message formats of
 * `INIT_OTP_V3`, `VERIFY_OTP_V2`, the sign-up client signature and `OTP_LOGIN_V2`.
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
 * Without `OTP_SUB_ORG` the run signs up a new account. With it, the run logs back
 * into that existing account and exercises a session policy on it. Each run spends
 * one or two signatures.
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
  /** Set to log back into an existing account instead of signing up. */
  subOrgId?: string;
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
  const client = new TurnkeyClient({
    transport: createHttpTransport({ baseUrl: TURNKEY_API_BASE_URL }),
  });
  const signerPair = generateApiKeyPair();
  const provider = live
    ? new TurnkeyKeyProvider({
        client,
        kind: 'turnkey',
        parentOrgId: env.TURNKEY_ORG_ID ?? '',
        parentStamper: createApiKeyStamper({
          publicKey: env.TURNKEY_API_PUBLIC_KEY ?? '',
          privateKey: env.TURNKEY_API_PRIVATE_KEY ?? '',
        }),
        signerStamper: createApiKeyStamper(signerPair),
      })
    : null;

  const code = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    return error instanceof KeyProviderError ? error.code : String(error);
  };

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
      ...(env.OTP_SUB_ORG ? { subOrgId: env.OTP_SUB_ORG } : {}),
    };
    console.info(`SENT to ${env.OTP_EMAIL}, session key ${key.publicKey}`);
    console.info(
      `OTP_STATE=${base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(state)))}`,
    );
    expect(started.encryptionTargetBundle.length).toBeGreaterThan(100);
  });

  it('step 2: encrypts the code, then signs up or logs back in', { timeout: 180_000 }, async () => {
    if (!provider || !env.OTP_CODE || !env.OTP_STATE) return;
    const state = JSON.parse(
      new TextDecoder().decode(base64urlnopad.decode(env.OTP_STATE)),
    ) as OtpState;
    const key = await toSessionKey(state.secret);
    const stamper = sessionStamper(key);

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
    if (!state.subOrgId) {
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
        stamper,
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
      return;
    }

    // Logging back into the account created by an earlier run: a fresh session key,
    // registered by `OTP_LOGIN_V2` and approved by that key's own signature.
    const subOrgId = state.subOrgId;
    const session = await provider.otpLogin({
      subOrgId,
      verificationToken,
      publicKey: key.publicKey,
      clientSignature: await loginSignature({ key, verificationToken }),
      expirationSeconds: 3600,
    });
    expect(session.subOrgId).toBe(subOrgId);
    expect(session.publicKey).toBe(key.publicKey);
    console.info('LOGGED IN', session.userId, session.expiresAt.toISOString());

    // The new session key can read the account it just gained access to.
    const { wallets } = await client.query<{ wallets: { walletId: string }[] }>(
      '/public/v1/query/list_wallets',
      { organizationId: subOrgId },
      stamper,
    );
    const walletId = wallets[0]?.walletId ?? '';
    const { accounts } = await client.query<{
      accounts: { address: string; addressFormat: string }[];
    }>('/public/v1/query/list_wallet_accounts', { organizationId: subOrgId, walletId }, stamper);
    const address =
      accounts.find((candidate) => candidate.addressFormat === 'ADDRESS_FORMAT_ETHEREUM')
        ?.address ?? '';
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Session policy created by the user, then used by the Pocketkey signer alone.
    const { signerUserId } = await provider.relay(
      await stampRequest(
        buildCreateSigner({ organizationId: subOrgId, signerPublicKey: signerPair.publicKey }),
        stamper,
      ),
      { kind: 'createSigner', subOrgId },
    );
    await provider.relay(
      await stampRequest(buildGrantRevoke({ organizationId: subOrgId, signerUserId }), stamper),
      { kind: 'grantRevoke', subOrgId, signerUserId },
    );
    const contract = '0x4200000000000000000000000000000000000006';
    const sessionInput = {
      policyName: `pocketkey:ses_otp_${Date.now()}`,
      policy: {
        chain: 'evm',
        expiresIn: '1h',
        allowedChains: [84532],
        allowedContracts: [contract],
        maxValuePerTx: '1000',
      } as SigningPolicy,
      walletId,
      address,
      signerUserId,
      expiresAt: new Date(Date.now() + 3600_000),
    };
    const { policyId } = await provider.relay(
      await stampRequest(
        buildSessionPolicy({ organizationId: subOrgId, ...sessionInput }),
        stamper,
      ),
      { kind: 'createSessionPolicy', subOrgId, ...sessionInput },
    );

    const tx = (to: Hex, value: bigint) =>
      serializeTransaction({
        chainId: 84532,
        type: 'eip1559',
        to,
        value,
        nonce: 0,
        gas: 21000n,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1n,
      });
    const sign = (unsignedTransaction: string, policyCreatedAt: Date) =>
      provider.signTransaction({
        subOrgId,
        address,
        chainFamily: 'evm',
        unsignedTransaction,
        scope: { kind: 'session', policyId, policyCreatedAt },
      });

    const { signedTransaction } = await sign(tx(contract, 5n), new Date());
    expect(
      await recoverTransactionAddress({
        serializedTransaction: signedTransaction as `0x02${string}`,
      }),
    ).toBe(address);
    const settled = new Date(0);
    expect(await code(sign(tx('0x1111111111111111111111111111111111111111', 5n), settled))).toBe(
      'policy_denied',
    );

    // The signer may only revoke, and loses everything once the policy is gone.
    await provider.deletePolicy({ subOrgId, policyId });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await code(sign(tx(contract, 5n), settled))).toBe('policy_denied');
    console.info('SESSION POLICY OK', policyId);
  });
});
