import {
  buildAddPasskey,
  stampRequest,
  webauthnChallenge,
  type Stamper,
} from '@pocketkey/key-provider/client';
import { TestAuthenticator } from '@pocketkey/key-provider/testing';
import { ApiErrorBody, EndUser, type KeySession } from '@pocketkey/types';
import { beforeAll, describe, expect, it } from 'vitest';
import { getEmulator } from '../src/lib/key-provider.js';
import { Device } from './device.js';
import { createTestApp, postJson, SEED, seedDb } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

/** Stamped `createAuthenticators` for `authenticator`, as the iframe sends it. */
async function addPasskeyRequest(
  keySession: Pick<KeySession, 'organizationId' | 'userId'>,
  stamper: Stamper,
  authenticator: TestAuthenticator,
) {
  const registration = authenticator.register(crypto.getRandomValues(new Uint8Array(32)));
  return stampRequest(
    buildAddPasskey({
      organizationId: keySession.organizationId,
      userId: keySession.userId,
      name: 'Test key',
      ...registration,
    }),
    stamper,
  );
}

async function register(device: Device, authenticator: TestAuthenticator) {
  const request = await addPasskeyRequest(device.keySession, device.stamper, authenticator);
  return postJson('/v1/auth/passkey/register', { request }, device.headers(), device.publicId);
}

describe('passkeys (T1.2, non-custodial)', () => {
  it('enrolls a passkey after an email login, then signs in with it on a fresh device', async () => {
    const device = await Device.loginWithEmail('passkey@test.dev');
    const authenticator = new TestAuthenticator();

    const enrolled = await register(device, authenticator);
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);
    const user = EndUser.parse(await enrolled.json());
    expect(user.identities.map((identity) => identity.type).sort()).toEqual(['email', 'passkey']);
    expect(user.identities.find((identity) => identity.type === 'passkey')?.identifier).toBe(
      authenticator.credentialId,
    );
    // The passkey is a credential of the user's own sub-organization.
    expect(getEmulator().inspect(device.keySession.organizationId).rootUser.passkeys).toEqual([
      authenticator.credentialId,
    ]);

    // Fresh device: no token, only a login request signed by the passkey.
    const { device: fresh, response } = await Device.loginWithPasskey((challenge) =>
      authenticator.assert(challenge),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(fresh?.auth.isNewUser).toBe(false);
    expect(fresh?.auth.user.id).toBe(device.auth.user.id);
    expect(fresh?.keySession.organizationId).toBe(device.keySession.organizationId);
    expect(getEmulator().inspect(device.keySession.organizationId).rootUser.apiKeys).toContain(
      fresh?.key.publicKey,
    );
  });

  it('refuses an assertion signed for another request', async () => {
    const device = await Device.loginWithEmail('passkey-replay@test.dev');
    const authenticator = new TestAuthenticator();
    expect((await register(device, authenticator)).status).toBe(200);

    const { device: none, response } = await Device.loginWithPasskey(() =>
      authenticator.assert(webauthnChallenge('{"another":"body"}')),
    );
    expect(none).toBeNull();
    expect(response.status).toBe(401);
  });

  it('refuses a passkey that was never enrolled', async () => {
    const stranger = new TestAuthenticator();
    const { response } = await Device.loginWithPasskey((challenge) => stranger.assert(challenge));
    expect(response.status).toBe(401);
  });

  it('refuses a passkey of another app', async () => {
    const other = await createTestApp({ loginMethods: ['email', 'passkey'] });
    const device = await Device.loginWithEmail('passkey-other@test.dev', {
      publicId: other.publicId,
    });
    const authenticator = new TestAuthenticator();
    const enrolled = await register(device, authenticator);
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);

    // Valid at the key provider, but no end user of the seed app owns that sub-organization.
    const { response } = await Device.loginWithPasskey(
      (challenge) => authenticator.assert(challenge),
      SEED.app.publicId,
    );
    expect(response.status).toBe(401);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('unauthorized');

    const home = await Device.loginWithPasskey(
      (challenge) => authenticator.assert(challenge),
      other.publicId,
    );
    expect(home.response.status, await home.response.clone().text()).toBe(200);
    expect(home.device?.auth.user.id).toBe(device.auth.user.id);
  });

  it('refuses a registration without a session', async () => {
    const device = await Device.loginWithEmail('passkey-anon@test.dev');
    const request = await addPasskeyRequest(
      device.keySession,
      device.stamper,
      new TestAuthenticator(),
    );
    const res = await postJson('/v1/auth/passkey/register', { request });
    expect(res.status).toBe(401);
  });

  it('refuses a registration aimed at another user', async () => {
    const alice = await Device.loginWithEmail('passkey-alice@test.dev');
    const bob = await Device.loginWithEmail('passkey-bob@test.dev');
    const authenticator = new TestAuthenticator();

    // Alice's token, but a request for Bob's sub-organization.
    const request = await addPasskeyRequest(bob.keySession, bob.stamper, authenticator);
    const res = await postJson('/v1/auth/passkey/register', { request }, alice.headers());
    expect(res.status).toBe(400);
    expect(getEmulator().inspect(bob.keySession.organizationId).rootUser.passkeys).toEqual([]);
  });

  it('is refused when the app disabled passkeys', async () => {
    const emailOnly = await createTestApp({ loginMethods: ['email'] });
    const authenticator = new TestAuthenticator();
    const { response } = await Device.loginWithPasskey(
      (challenge) => authenticator.assert(challenge),
      emailOnly.publicId,
    );
    expect(response.status).toBe(403);
  });
});
