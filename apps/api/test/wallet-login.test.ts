import { ed25519 } from '@noble/curves/ed25519.js';
import {
  buildLogin,
  evmWalletStamp,
  generateSessionKey,
  solanaWalletStamp,
} from '@pockey/key-provider/client';
import { ApiErrorBody } from '@pockey/types';
import { base58, base64urlnopad } from '@scure/base';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeAll, describe, expect, it } from 'vitest';
import { getEmulator } from '../src/lib/key-provider.js';
import { appConfig, Device } from './device.js';
import { createTestApp, postJson, seedDb } from './helpers.js';

beforeAll(async () => {
  await seedDb();
});

const newEvm = () => privateKeyToAccount(generatePrivateKey());

function newSolana() {
  const secretKey = ed25519.utils.randomSecretKey();
  return {
    address: base58.encode(ed25519.getPublicKey(secretKey)),
    sign: async (bytes: Uint8Array) => ed25519.sign(bytes, secretKey),
  };
}

async function lookup(chainFamily: 'evm' | 'solana', address: string, publicId?: string) {
  const res = await postJson('/v1/auth/wallet/lookup', { chainFamily, address }, {}, publicId);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json<{ organizationId: string | null }>()).organizationId;
}

async function parentOrganizationId(): Promise<string> {
  return (await appConfig()).keyProvider.organizationId;
}

interface LoginRequest {
  path: string;
  body: string;
  stamp: { header: string; value: string };
}

function login(chainFamily: 'evm' | 'solana', request: LoginRequest, publicId?: string) {
  return postJson('/v1/auth/wallet/login', { chainFamily, request }, {}, publicId);
}

interface StampJson {
  publicKey: string;
  scheme: string;
  signature: string;
}
const readStamp = (value: string) =>
  JSON.parse(new TextDecoder().decode(base64urlnopad.decode(value))) as StampJson;
const writeStamp = (json: StampJson) =>
  base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(json)));

describe('EVM wallet login (T1.3, non-custodial)', () => {
  it('signs up an EVM wallet, then logs in to the same user', async () => {
    const account = newEvm();
    expect(await lookup('evm', account.address)).toBeNull();

    const first = await Device.loginWithWallet({ evm: account });
    expect(first.response.status, await first.response.clone().text()).toBe(200);
    expect(first.device.auth.isNewUser).toBe(true);
    expect(first.device.auth.user.identities).toEqual([
      expect.objectContaining({
        type: 'wallet',
        identifier: `evm:${account.address.toLowerCase()}`,
      }),
    ]);
    const organizationId = first.device.keySession.organizationId;
    // The wallet key and the iframe key are the only root credentials.
    expect(getEmulator().inspect(organizationId).rootUser.apiKeys).toHaveLength(2);
    expect(getEmulator().inspect(organizationId).rootUser.apiKeys).toContain(
      first.device.key.publicKey,
    );

    expect(await lookup('evm', account.address)).toBe(organizationId);
    const second = await Device.loginWithWallet({ evm: account });
    expect(second.response.status, await second.response.clone().text()).toBe(200);
    expect(second.device.auth.isNewUser).toBe(false);
    expect(second.device.auth.user.id).toBe(first.device.auth.user.id);
    expect(second.device.keySession.organizationId).toBe(organizationId);
    expect(getEmulator().inspect(organizationId).rootUser.apiKeys).toContain(
      second.device.key.publicKey,
    );
  });

  it('refuses a stamp whose signature comes from another key', async () => {
    const victim = newEvm();
    const attacker = newEvm();
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: await parentOrganizationId(),
      publicKey: key.publicKey,
    });
    const claimed = await evmWalletStamp(prepared.body, (message) =>
      victim.signMessage({ message }),
    );
    const signed = await evmWalletStamp(prepared.body, (message) =>
      attacker.signMessage({ message }),
    );
    const forged = {
      ...claimed,
      value: writeStamp({
        ...readStamp(claimed.value),
        signature: readStamp(signed.value).signature,
      }),
    };
    const res = await login('evm', { ...prepared, stamp: forged });
    expect(res.status).toBe(401);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('unauthorized');
    expect(await lookup('evm', victim.address)).toBeNull();
  });

  it('refuses a login request that targets another organization', async () => {
    const alice = newEvm();
    const bob = newEvm();
    const aliceLogin = await Device.loginWithWallet({ evm: alice });
    expect(aliceLogin.response.status).toBe(200);
    expect((await Device.loginWithWallet({ evm: bob })).response.status).toBe(200);

    // Bob signs a login addressed to Alice's sub-organization.
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: aliceLogin.device.keySession.organizationId,
      publicKey: key.publicKey,
    });
    const stamp = await evmWalletStamp(prepared.body, (message) => bob.signMessage({ message }));
    const res = await login('evm', { ...prepared, stamp });
    expect(res.status).toBe(400);
    expect(
      getEmulator().inspect(aliceLogin.device.keySession.organizationId).rootUser.apiKeys,
    ).not.toContain(key.publicKey);

    // A sign-up must target the parent organization.
    const newcomer = newEvm();
    const signup = buildLogin({
      parentOrganizationId: aliceLogin.device.keySession.organizationId,
      publicKey: key.publicKey,
    });
    const signupStamp = await evmWalletStamp(signup.body, (message) =>
      newcomer.signMessage({ message }),
    );
    expect((await login('evm', { ...signup, stamp: signupStamp })).status).toBe(400);
  });

  it('refuses a login request signed as the other chain family', async () => {
    const account = newEvm();
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: await parentOrganizationId(),
      publicKey: key.publicKey,
    });
    const stamp = await evmWalletStamp(prepared.body, (message) =>
      account.signMessage({ message }),
    );
    expect((await login('solana', { ...prepared, stamp })).status).toBe(401);
  });

  it('keeps wallet users per app', async () => {
    const other = await createTestApp({ loginMethods: ['wallet'] });
    const account = newEvm();
    const inSeed = await Device.loginWithWallet({ evm: account });
    expect(inSeed.response.status).toBe(200);
    expect(await lookup('evm', account.address, other.publicId)).toBeNull();

    const inOther = await Device.loginWithWallet({ evm: account }, other.publicId);
    expect(inOther.response.status, await inOther.response.clone().text()).toBe(200);
    expect(inOther.device.auth.isNewUser).toBe(true);
    expect(inOther.device.auth.user.id).not.toBe(inSeed.device.auth.user.id);
  });

  it('is refused when the app disabled wallet login', async () => {
    const emailOnly = await createTestApp({ loginMethods: ['email'] });
    const account = newEvm();
    const res = await postJson(
      '/v1/auth/wallet/lookup',
      { chainFamily: 'evm', address: account.address },
      { Origin: 'https://other.example' },
      emailOnly.publicId,
    );
    expect(res.status).toBe(403);

    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: await parentOrganizationId(),
      publicKey: key.publicKey,
    });
    const stamp = await evmWalletStamp(prepared.body, (message) =>
      account.signMessage({ message }),
    );
    expect((await login('evm', { ...prepared, stamp }, emailOnly.publicId)).status).toBe(403);
  });
});

describe('Solana wallet login (T1.3, non-custodial)', () => {
  it('signs up a Solana wallet, then logs in to the same user', async () => {
    const wallet = newSolana();
    const first = await Device.loginWithWallet({ solana: wallet });
    expect(first.response.status, await first.response.clone().text()).toBe(200);
    expect(first.device.auth.isNewUser).toBe(true);
    expect(first.device.auth.user.identities[0]?.identifier).toBe(`solana:${wallet.address}`);

    expect(await lookup('solana', wallet.address)).toBe(first.device.keySession.organizationId);
    const second = await Device.loginWithWallet({ solana: wallet });
    expect(second.response.status, await second.response.clone().text()).toBe(200);
    expect(second.device.auth.isNewUser).toBe(false);
    expect(second.device.auth.user.id).toBe(first.device.auth.user.id);
  });

  it('refuses a public key that did not sign', async () => {
    const victim = newSolana();
    const attacker = newSolana();
    const key = await generateSessionKey();
    const prepared = buildLogin({
      parentOrganizationId: await parentOrganizationId(),
      publicKey: key.publicKey,
    });
    const stamp = await solanaWalletStamp(prepared.body, victim.address, attacker.sign);
    const res = await login('solana', { ...prepared, stamp });
    expect(res.status).toBe(401);
    expect(await lookup('solana', victim.address)).toBeNull();
  });
});
