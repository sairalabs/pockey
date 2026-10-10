import type { SigningPolicy } from '@pockey/types';
import { describe, expect, it } from 'vitest';
import { recoverTransactionAddress, serializeTransaction, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { KeyProviderError, type StampedRequest } from '../index.js';
import {
  buildAddPasskey,
  buildCreateSigner,
  buildExportAccount,
  buildGrantRevoke,
  buildLogin,
  buildSessionPolicy,
  evmWalletStamp,
  generateExportKey,
  generateSessionKey,
  sessionStamper,
  stampRequest,
  webauthnChallenge,
  webauthnStamp,
} from './client.js';
import { decryptExport } from './client-crypto.js';
import { createHttpTransport, TurnkeyClient } from './http.js';
import { TurnkeyKeyProvider } from './provider.js';
import { createApiKeyStamper, generateApiKeyPair, type Stamper } from './stamp.js';
import { TestAuthenticator } from './test-authenticator.js';
import { ACTIVITY, QUERY_PATH, TURNKEY_API_BASE_URL } from './wire.js';

/**
 * Contract test against a real Turnkey organization. Skipped unless
 * TURNKEY_LIVE=1 and the three TURNKEY_* variables are set, for example:
 *
 *   set -a; . ../../apps/api/.dev.vars; set +a; TURNKEY_LIVE=1 pnpm vitest run live
 *
 * It runs the provider and the iframe builders exactly as the app does, with an
 * external EVM wallet as the root credential (email OTP needs a real inbox and is
 * checked by hand, see TURNKEY.md). Every sub-organization is deleted at the end.
 */
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const live =
  env.TURNKEY_LIVE === '1' &&
  Boolean(env.TURNKEY_ORG_ID && env.TURNKEY_API_PUBLIC_KEY && env.TURNKEY_API_PRIVATE_KEY);

describe.skipIf(!live)('Turnkey live contract', () => {
  const client = new TurnkeyClient({
    transport: createHttpTransport({ baseUrl: TURNKEY_API_BASE_URL }),
  });
  const parentOrgId = env.TURNKEY_ORG_ID ?? '';
  const parentPair = {
    publicKey: env.TURNKEY_API_PUBLIC_KEY ?? '',
    privateKey: env.TURNKEY_API_PRIVATE_KEY ?? '',
  };
  const signerPair = generateApiKeyPair();
  const provider = live
    ? new TurnkeyKeyProvider({
        client,
        kind: 'turnkey',
        parentOrgId,
        parentStamper: createApiKeyStamper(parentPair),
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

  async function cleanup(subOrgId: string, stamper: Stamper) {
    await client.activity(
      ACTIVITY.deleteSubOrganization,
      subOrgId,
      { deleteWithoutExport: true },
      stamper,
    );
  }

  it('wallet sign-up, session signer, export and passkey, end to end', async () => {
    if (!provider) return;
    const whoami = await client.query<{ organizationId: string }>(
      QUERY_PATH.whoami,
      { organizationId: parentOrgId },
      createApiKeyStamper(parentPair),
    );
    expect(whoami.organizationId).toBe(parentOrgId);

    // Wallet sign-up: unknown credential first, then a sub-organization owned by it.
    const wallet = privateKeyToAccount(generatePrivateKey());
    const key = await generateSessionKey();
    const prepared = buildLogin({ parentOrganizationId: parentOrgId, publicKey: key.publicKey });
    const login: StampedRequest = {
      ...prepared,
      stamp: await evmWalletStamp(prepared.body, (message) => wallet.signMessage({ message })),
    };
    const identity = provider.inspectStamp(login);
    expect(identity?.scheme).toBe('secp256k1');
    expect(await code(provider.relay(login, { kind: 'login' }))).toBe('unauthenticated');
    const user = await provider.createSubOrganization({
      endUserId: 'usr_live',
      root: {
        kind: 'wallet',
        chainFamily: 'evm',
        publicKey: identity?.scheme === 'secp256k1' ? identity.publicKey : '',
      },
    });
    const stamper = sessionStamper(key);

    try {
      const session = await provider.relay(login, { kind: 'login' });
      expect(session.subOrgId).toBe(user.subOrgId);
      expect(session.publicKey).toBe(key.publicKey);

      // Signer user, revoke permission and a narrow session policy, all stamped by the user.
      const { signerUserId } = await provider.relay(
        await stampRequest(
          buildCreateSigner({
            organizationId: user.subOrgId,
            signerPublicKey: signerPair.publicKey,
          }),
          stamper,
        ),
        { kind: 'createSigner', subOrgId: user.subOrgId },
      );
      await provider.relay(
        await stampRequest(
          buildGrantRevoke({ organizationId: user.subOrgId, signerUserId }),
          stamper,
        ),
        { kind: 'grantRevoke', subOrgId: user.subOrgId, signerUserId },
      );
      const contract = '0x4200000000000000000000000000000000000006';
      const policy = {
        chain: 'evm',
        expiresIn: '1h',
        allowedChains: [84532],
        allowedContracts: [contract],
        maxValuePerTx: '1000',
      } as SigningPolicy;
      const account = user.accounts.evm;
      const sessionInput = {
        policyName: 'pockey:ses_live',
        policy,
        walletId: account.walletId,
        address: account.address,
        signerUserId,
        expiresAt: new Date(Date.now() + 3600_000),
      };
      const { policyId } = await provider.relay(
        await stampRequest(
          buildSessionPolicy({ organizationId: user.subOrgId, ...sessionInput }),
          stamper,
        ),
        { kind: 'createSessionPolicy', subOrgId: user.subOrgId, ...sessionInput },
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
          subOrgId: user.subOrgId,
          address: account.address,
          chainFamily: 'evm',
          unsignedTransaction,
          scope: { kind: 'session', policyId, policyCreatedAt },
        });

      const { signedTransaction } = await sign(tx(contract, 5n), new Date());
      expect(
        await recoverTransactionAddress({
          serializedTransaction: signedTransaction as `0x02${string}`,
        }),
      ).toBe(account.address);
      const settled = new Date(0);
      expect(await code(sign(tx('0x1111111111111111111111111111111111111111', 5n), settled))).toBe(
        'policy_denied',
      );
      expect(await code(sign(tx(contract, 5000n), settled))).toBe('policy_denied');

      // Revocation by the signer, allowed by the revoke permission only.
      await provider.deletePolicy({ subOrgId: user.subOrgId, policyId });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(await code(sign(tx(contract, 5n), settled))).toBe('policy_denied');

      // Export to an iframe key, decrypted against Turnkey's pinned production signer key.
      const exportKey = generateExportKey();
      const { exportBundle } = await provider.relay(
        await stampRequest(
          buildExportAccount({
            organizationId: user.subOrgId,
            address: account.address,
            targetPublicKey: exportKey.publicKey,
          }),
          stamper,
        ),
        { kind: 'exportAccount', subOrgId: user.subOrgId, address: account.address },
      );
      const secret = await decryptExport({
        exportBundle,
        key: exportKey,
        organizationId: user.subOrgId,
        chainFamily: 'evm',
      });
      expect(privateKeyToAccount(secret as Hex).address).toBe(account.address);

      // Passkey added by the user, then a login that does not name the user.
      const authenticator = new TestAuthenticator();
      const registration = authenticator.register(crypto.getRandomValues(new Uint8Array(32)));
      const added = await code(
        provider.relay(
          await stampRequest(
            buildAddPasskey({
              organizationId: user.subOrgId,
              userId: session.userId,
              name: 'Live test',
              ...registration,
            }),
            stamper,
          ),
          { kind: 'addPasskey', subOrgId: user.subOrgId, userId: session.userId },
        ),
      );
      console.info(`passkey registration with a software authenticator: ${added}`);
      if (added === 'null') {
        const passkeyKey = await generateSessionKey();
        const loginBody = buildLogin({
          parentOrganizationId: parentOrgId,
          publicKey: passkeyKey.publicKey,
        });
        const passkeyLogin = await provider.relay(
          {
            ...loginBody,
            stamp: webauthnStamp(authenticator.assert(webauthnChallenge(loginBody.body))),
          },
          { kind: 'login' },
        );
        expect(passkeyLogin.subOrgId).toBe(user.subOrgId);
      }
    } finally {
      await cleanup(user.subOrgId, stamper);
    }
  }, 120_000);

  it('system accounts belong to the signer only', async () => {
    if (!provider) return;
    const { subOrgId, account } = await provider.createSystemAccount({
      name: 'live-fee-payer',
      chainFamily: 'solana',
    });
    try {
      const { signature } = await provider.signRaw({
        subOrgId,
        address: account.address,
        payload: new TextEncoder().encode('fee payer'),
        encoding: 'raw',
        scope: { kind: 'system' },
      });
      expect(signature.length).toBe(64);
    } finally {
      await cleanup(subOrgId, createApiKeyStamper(signerPair));
    }
  }, 60_000);
});
