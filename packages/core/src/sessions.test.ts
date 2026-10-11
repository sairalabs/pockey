import { SessionSigner, type CreateSessionInput } from '@pockey/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPockey, isSessionActive, type PockeyClient } from './client.js';
import { isPockeyError, policyViolationReason, PockeyError } from './errors.js';
import { memoryStorage, type TokenStorage } from './storage.js';
import {
  apiError,
  APP_ID,
  appConfig,
  BASE_URL,
  fakeApi,
  fakeKeys,
  json,
  keySession,
  routeEmailLogin,
  SIGNER_PUBLIC_KEY,
  stamped,
  wallet,
  type FakeApi,
  type FakeKeys,
} from './test-utils.js';

const SESSION_ID = 'ses_a1b2c3d4e5f6g7h8i9j0k1l2';

function session(overrides: Partial<SessionSigner> = {}): SessionSigner {
  return SessionSigner.parse({
    id: SESSION_ID,
    walletId: wallet('evm').id,
    policy: { chain: 'evm', expiresIn: '7d', maxValuePerTx: '1000000000000000000' },
    spentTotal: '0',
    expiresAt: '2026-09-24T10:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  });
}

let api: FakeApi;
let keys: FakeKeys;
let storage: TokenStorage;

async function signedIn(signerUserId: string | null = null): Promise<PockeyClient> {
  routeEmailLogin(api, { session: keySession({ signerUserId }) });
  const pk = createPockey({
    appId: APP_ID,
    baseUrl: BASE_URL,
    storage,
    fetch: api.fetch,
    keys: keys.keys,
  });
  await pk.auth.loginWithEmail('a@test.dev');
  await pk.auth.verifyOtp('123456');
  return pk;
}

function routeSigner() {
  api.on('GET', `/v1/apps/${APP_ID}/config`, () => json(appConfig()));
  api.on('POST', '/v1/sessions/signer', () => json({ signerUserId: 'tk_signer' }));
  api.on('POST', '/v1/sessions/signer/permission', () => json({ ok: true }));
}

async function rejection(promise: Promise<unknown>): Promise<PockeyError> {
  try {
    await promise;
  } catch (e) {
    if (isPockeyError(e)) return e;
    throw e;
  }
  throw new Error('Expected a rejection');
}

beforeEach(() => {
  api = fakeApi();
  keys = fakeKeys();
  storage = memoryStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sessions', () => {
  it('create adds the signer once, stamps the policy and posts it with auth', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-19T10:00:00.000Z'));
    const pk = await signedIn();
    routeSigner();
    const created = session();
    api.on('POST', '/v1/sessions', () => json(created, 201));
    const input: CreateSessionInput = { walletId: created.walletId, policy: created.policy };
    const ks = keySession();

    await expect(pk.sessions.create(input)).resolves.toEqual(created);

    expect(api.routes().slice(-4)).toEqual([
      `GET /v1/apps/${APP_ID}/config`,
      'POST /v1/sessions/signer',
      'POST /v1/sessions/signer/permission',
      'POST /v1/sessions',
    ]);
    expect(keys.methods().slice(-3)).toEqual(['createSigner', 'grantRevoke', 'sessionPolicy']);
    expect(keys.inputOf('createSigner')).toEqual({
      organizationId: ks.organizationId,
      signerPublicKey: SIGNER_PUBLIC_KEY,
    });
    expect(api.last('POST', '/v1/sessions/signer')?.body).toEqual({
      createSigner: stamped('create_users', {
        organizationId: ks.organizationId,
        signerPublicKey: SIGNER_PUBLIC_KEY,
      }),
    });
    expect(keys.inputOf('grantRevoke')).toEqual({
      organizationId: ks.organizationId,
      signerUserId: 'tk_signer',
    });
    expect(api.last('POST', '/v1/sessions/signer/permission')?.body).toEqual({
      request: stamped('create_policy', { grant: 'tk_signer' }),
    });

    const expiresAt = new Date('2026-09-26T10:00:00.000Z');
    const policyInput = keys.inputOf('sessionPolicy');
    expect(policyInput).toEqual({
      organizationId: ks.organizationId,
      policyName: expect.stringMatching(/^pockey:ses:[A-Za-z0-9_-]{8,40}$/),
      policy: input.policy,
      walletId: ks.accounts.evm.walletId,
      address: ks.accounts.evm.address,
      signerUserId: 'tk_signer',
      expiresAt,
    });
    const call = api.last('POST', '/v1/sessions');
    expect(call?.body).toEqual({
      ...input,
      policyName: policyInput?.policyName,
      expiresAt: expiresAt.toISOString(),
      request: stamped('create_policy', { policyName: policyInput?.policyName }),
    });
    expect(call?.headers.authorization).toMatch(/^Bearer /);
    expect(call?.headers['x-pockey-app-id']).toBe(APP_ID);

    // The signer is remembered: a second session only stamps its policy.
    await pk.sessions.create(input);
    expect(api.count('POST', '/v1/sessions/signer')).toBe(1);
    expect(keys.methods().slice(-2)).toEqual(['sessionPolicy', 'sessionPolicy']);
    expect(JSON.parse((await storage.get(`pockey:${APP_ID}:keySession`)) ?? 'null')).toMatchObject({
      signerUserId: 'tk_signer',
    });
  });

  it('create skips the signer setup when the key session already has one', async () => {
    const pk = await signedIn('tk_existing');
    api.on('POST', '/v1/sessions', () => json(session(), 201));
    await pk.sessions.create({
      walletId: wallet('solana').id,
      policy: { chain: 'solana', expiresIn: '1h' },
    });
    expect(api.count(`GET`, `/v1/apps/${APP_ID}/config`)).toBe(0);
    expect(api.count('POST', '/v1/sessions/signer')).toBe(0);
    expect(keys.inputOf('sessionPolicy')).toMatchObject({
      signerUserId: 'tk_existing',
      walletId: keySession().accounts.solana.walletId,
      address: keySession().accounts.solana.address,
    });
  });

  it('create stops before posting when the key client has no session key', async () => {
    const pk = await signedIn('tk_existing');
    keys.state.active = false;
    const error = await rejection(
      pk.sessions.create({ walletId: session().walletId, policy: session().policy }),
    );
    expect(error.code).toBe('not_authenticated');
    expect(error.details).toEqual({ reason: 'key_session_missing' });
    expect(api.count('POST', '/v1/sessions')).toBe(0);
  });

  it('create rejects invalid_response when the body is not a session signer', async () => {
    const pk = await signedIn('tk_existing');
    api.on('POST', '/v1/sessions', () => json({ id: 'nope' }, 201));
    const error = await rejection(
      pk.sessions.create({ walletId: session().walletId, policy: session().policy }),
    );
    expect(error.code).toBe('invalid_response');
  });

  it('list unwraps the sessions array', async () => {
    const pk = await signedIn();
    const revoked = session({ revokedAt: '2026-09-17T11:00:00.000Z' });
    api.on('GET', '/v1/sessions', () => json({ sessions: [session(), revoked] }));
    await expect(pk.sessions.list()).resolves.toEqual([session(), revoked]);
  });

  it('revoke sends DELETE on the encoded id and resolves void', async () => {
    const pk = await signedIn();
    api.on('DELETE', `/v1/sessions/${SESSION_ID}`, () => json({ ok: true }));
    await expect(pk.sessions.revoke(SESSION_ID)).resolves.toBeUndefined();
    expect(api.count('DELETE', `/v1/sessions/${SESSION_ID}`)).toBe(1);

    await rejection(pk.sessions.revoke('a/b'));
    expect(api.calls.at(-1)?.path).toBe('/v1/sessions/a%2Fb');
  });

  it('sign posts the request as given and returns the output', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/sessions/${SESSION_ID}/sign`, () =>
      json({ hash: '0xhash', sponsored: false }),
    );
    const request = {
      kind: 'transaction' as const,
      input: {
        chain: 'evm' as const,
        chainId: 8453 as const,
        to: '0x2222222222222222222222222222222222222222',
        value: '1',
      },
    };
    await expect(pk.sessions.sign(SESSION_ID, request)).resolves.toEqual({
      hash: '0xhash',
      sponsored: false,
    });
    expect(api.last('POST', `/v1/sessions/${SESSION_ID}/sign`)?.body).toEqual(request);
  });

  it('maps a policy refusal to policy_violation with details.reason', async () => {
    const pk = await signedIn();
    api.on('POST', `/v1/sessions/${SESSION_ID}/sign`, () =>
      apiError('policy_violation', 403, { reason: 'value_per_tx_exceeded' }),
    );
    const error = await rejection(
      pk.sessions.sign(SESSION_ID, { kind: 'message', input: { chain: 'evm', message: 'gm' } }),
    );
    expect(error).toBeInstanceOf(PockeyError);
    expect(error.code).toBe('policy_violation');
    expect(error.status).toBe(403);
    expect(error.details).toEqual({ reason: 'value_per_tx_exceeded' });
    expect(policyViolationReason(error)).toBe('value_per_tx_exceeded');
  });

  it('policyViolationReason accepts provider_denied and ignores anything else', () => {
    const refusal = (details: unknown) =>
      new PockeyError('policy_violation', 'refused', { status: 403, details });
    expect(policyViolationReason(refusal({ reason: 'provider_denied' }))).toBe('provider_denied');
    expect(policyViolationReason(refusal({ reason: 'made_up' }))).toBeNull();
    expect(policyViolationReason(refusal(undefined))).toBeNull();
    expect(
      policyViolationReason(
        new PockeyError('forbidden', 'no', { details: { reason: 'session_revoked' } }),
      ),
    ).toBeNull();
    expect(policyViolationReason(new Error('policy_violation'))).toBeNull();
  });

  it('rejects not_authenticated without calling the API when logged out', async () => {
    const pk = createPockey({
      appId: APP_ID,
      baseUrl: BASE_URL,
      storage: memoryStorage(),
      fetch: api.fetch,
      keys: keys.keys,
    });
    expect((await rejection(pk.sessions.list())).code).toBe('not_authenticated');
    expect((await rejection(pk.sessions.revoke(SESSION_ID))).code).toBe('not_authenticated');
    expect(
      (
        await rejection(
          pk.sessions.create({ walletId: session().walletId, policy: session().policy }),
        )
      ).code,
    ).toBe('not_authenticated');
    expect(api.calls).toHaveLength(0);
  });
});

describe('isActive', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');

  it('is true before expiry when not revoked', () => {
    expect(isSessionActive(session(), now)).toBe(true);
  });

  it('is false once revoked, even before expiry', () => {
    expect(isSessionActive(session({ revokedAt: '2026-09-18T00:00:00.000Z' }), now)).toBe(false);
  });

  it('is false exactly at expiry and after it', () => {
    const expiresAt = '2026-09-20T00:00:00.000Z';
    expect(isSessionActive(session({ expiresAt }), now)).toBe(false);
    expect(isSessionActive(session({ expiresAt }), new Date(Date.parse(expiresAt) - 1))).toBe(true);
    expect(isSessionActive(session({ expiresAt: '2026-09-19T23:59:59.000Z' }), now)).toBe(false);
  });

  it('defaults to the call time and is exposed on the client', async () => {
    const pk = await signedIn();
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(pk.sessions.isActive(session({ expiresAt: future }))).toBe(true);
    expect(pk.sessions.isActive(session({ expiresAt: past }))).toBe(false);
  });
});
