import { describe, expect, it } from 'vitest';
import { KeyProviderError } from '../index.js';
import { createHttpTransport, TurnkeyClient } from './http.js';
import { createApiKeyStamper, generateApiKeyPair } from './stamp.js';
import {
  ACTIVITY,
  activityResult,
  QUERY_PATH,
  TURNKEY_API_BASE_URL,
  WALLET_ACCOUNT,
} from './wire.js';

/**
 * Contract test against a real Turnkey organization. Skipped unless
 * TURNKEY_LIVE=1 and the three TURNKEY_* variables are set, for example:
 *
 *   set -a; . ../../apps/api/.dev.vars; set +a; TURNKEY_LIVE=1 pnpm vitest run live
 *
 * Every run creates one sub-organization and deletes it at the end.
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
  const parentOrg = env.TURNKEY_ORG_ID ?? '';
  const parent = live
    ? createApiKeyStamper({
        publicKey: env.TURNKEY_API_PUBLIC_KEY ?? '',
        privateKey: env.TURNKEY_API_PRIVATE_KEY ?? '',
      })
    : null;

  it('authenticates, and the parent cannot act inside a user sub-organization', async () => {
    if (!parent) return;
    const whoami = await client.query<{ organizationId: string }>(
      QUERY_PATH.whoami,
      { organizationId: parentOrg },
      parent,
    );
    expect(whoami.organizationId).toBe(parentOrg);

    const userPair = generateApiKeyPair();
    const user = createApiKeyStamper(userPair);
    const created = await client.activity(
      ACTIVITY.createSubOrganization,
      parentOrg,
      {
        subOrganizationName: `pocketkey-contract-${Date.now()}`,
        rootQuorumThreshold: 1,
        rootUsers: [
          {
            userName: 'end-user',
            apiKeys: [
              {
                apiKeyName: 'iframe',
                publicKey: userPair.publicKey,
                curveType: 'API_KEY_CURVE_P256',
              },
            ],
            authenticators: [],
            oauthProviders: [],
          },
        ],
      },
      parent,
    );
    const subOrgId = (
      activityResult(created, 'createSubOrganizationResult') as { subOrganizationId: string }
    ).subOrganizationId;

    try {
      const wallet = activityResult(
        await client.activity(
          ACTIVITY.createWallet,
          subOrgId,
          { walletName: 'default', accounts: [WALLET_ACCOUNT.evm] },
          user,
        ),
        'createWalletResult',
      ) as { walletId: string; addresses: string[] };
      const signWith = wallet.addresses[0] ?? '';
      const sign = (stamper: typeof user, retryUntil?: number) =>
        client.activity(
          ACTIVITY.signRawPayload,
          subOrgId,
          {
            signWith,
            payload: `0x${'11'.repeat(32)}`,
            encoding: 'PAYLOAD_ENCODING_HEXADECIMAL',
            hashFunction: 'HASH_FUNCTION_NO_OP',
          },
          stamper,
          retryUntil === undefined ? {} : { retryUntil },
        );

      const signed = activityResult(
        await sign(user, Date.now() + 5_000),
        'signRawPayloadResult',
      ) as { r: string };
      expect(signed.r).toMatch(/^[0-9a-fA-F]{64}$/);

      const denied = await sign(parent).catch((error: unknown) => error);
      expect(denied).toBeInstanceOf(KeyProviderError);
    } finally {
      await client.activity(
        ACTIVITY.deleteSubOrganization,
        subOrgId,
        { deleteWithoutExport: true },
        user,
      );
    }
  }, 60_000);
});
