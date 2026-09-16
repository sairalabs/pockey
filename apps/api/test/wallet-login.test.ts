import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { buildSiweMessage } from '@pocketkey/chains-evm';
import { buildSiwsMessage } from '@pocketkey/chains-solana';
import { ApiErrorBody, AuthResponse, WalletNonceOutput } from '@pocketkey/types';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, postJson, seedDb } from './helpers.js';

const DOMAIN = 'localhost:5174';
const URI = 'http://localhost:5174';

beforeAll(async () => {
  await seedDb();
});

async function nonceFor(chainFamily: 'evm' | 'solana', publicId?: string): Promise<string> {
  const res = await postJson('/v1/auth/wallet/nonce', { chainFamily }, {}, publicId);
  expect(res.status, await res.clone().text()).toBe(200);
  return WalletNonceOutput.parse(await res.json()).nonce;
}

async function siwe(account = privateKeyToAccount(generatePrivateKey()), domain = DOMAIN) {
  const nonce = await nonceFor('evm');
  const message = buildSiweMessage({
    domain,
    uri: URI,
    address: account.address,
    chainId: 8453,
    nonce,
  });
  const signature = await account.signMessage({ message });
  return { account, message, signature };
}

describe('SIWE login (T1.3)', () => {
  it('signs in an EVM wallet and reuses the user on the next login', async () => {
    const { account, message, signature } = await siwe();
    const first = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'evm',
      message,
      signature,
    });
    expect(first.status, await first.clone().text()).toBe(200);
    const body = AuthResponse.parse(await first.json());
    expect(body.isNewUser).toBe(true);
    expect(body.user.identities).toEqual([
      expect.objectContaining({
        type: 'wallet',
        identifier: `evm:${account.address.toLowerCase()}`,
      }),
    ]);

    const again = await siwe(account);
    const second = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'evm',
      message: again.message,
      signature: again.signature,
    });
    const secondBody = AuthResponse.parse(await second.json());
    expect(secondBody.isNewUser).toBe(false);
    expect(secondBody.user.id).toBe(body.user.id);
  });

  it('refuses a replayed message', async () => {
    const { message, signature } = await siwe();
    expect(
      (await postJson('/v1/auth/wallet/verify', { chainFamily: 'evm', message, signature })).status,
    ).toBe(200);
    const replay = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'evm',
      message,
      signature,
    });
    expect(replay.status).toBe(401);
  });

  it('refuses a message for another domain and burns the nonce', async () => {
    const { message, signature } = await siwe(undefined, 'evil.example');
    const res = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'evm',
      message,
      signature,
    });
    expect(res.status).toBe(401);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('unauthorized');
  });

  it('refuses a signature from another key', async () => {
    const { message } = await siwe();
    const signature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message });
    expect(
      (await postJson('/v1/auth/wallet/verify', { chainFamily: 'evm', message, signature })).status,
    ).toBe(401);
  });

  it('does not accept a nonce issued to another app', async () => {
    const other = await createTestApp({ loginMethods: ['wallet'] });
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await nonceFor('evm', other.publicId);
    const message = buildSiweMessage({
      domain: DOMAIN,
      uri: URI,
      address: account.address,
      chainId: 8453,
      nonce,
    });
    const signature = await account.signMessage({ message });
    const res = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'evm',
      message,
      signature,
    });
    expect(res.status).toBe(401);
  });

  it('is refused when the app disabled wallet login', async () => {
    const emailOnly = await createTestApp({ loginMethods: ['email'] });
    const res = await postJson(
      '/v1/auth/wallet/nonce',
      { chainFamily: 'evm' },
      { Origin: 'https://other.example' },
      emailOnly.publicId,
    );
    expect(res.status).toBe(403);
  });
});

describe('SIWS login (T1.3)', () => {
  it('signs in a Solana wallet', async () => {
    const secretKey = ed25519.utils.randomSecretKey();
    const address = base58.encode(ed25519.getPublicKey(secretKey));
    const nonce = await nonceFor('solana');
    const message = buildSiwsMessage({
      domain: DOMAIN,
      address,
      nonce,
      uri: URI,
      chainId: 'devnet',
    });
    const signature = base64.encode(ed25519.sign(new TextEncoder().encode(message), secretKey));

    const res = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'solana',
      message,
      signature,
      publicKey: address,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = AuthResponse.parse(await res.json());
    expect(body.user.identities[0]?.identifier).toBe(`solana:${address}`);
  });

  it('refuses a public key that did not sign', async () => {
    const secretKey = ed25519.utils.randomSecretKey();
    const address = base58.encode(ed25519.getPublicKey(secretKey));
    const impostor = base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    const nonce = await nonceFor('solana');
    const message = buildSiwsMessage({ domain: DOMAIN, address, nonce });
    const signature = base64.encode(ed25519.sign(new TextEncoder().encode(message), secretKey));
    const res = await postJson('/v1/auth/wallet/verify', {
      chainFamily: 'solana',
      message,
      signature,
      publicKey: impostor,
    });
    expect(res.status).toBe(401);
  });
});
