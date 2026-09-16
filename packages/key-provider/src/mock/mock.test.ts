import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { EvmAddress, SolanaAddress } from '@pocketkey/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { KeyProviderError } from '../index.js';
import { createMockKeyProvider, toChecksumAddress, type MockKeyProvider } from './index.js';

let kp: MockKeyProvider;

beforeEach(() => {
  kp = createMockKeyProvider();
});

describe('MockKeyProvider', () => {
  it('creates a sub-org and an EVM wallet with a checksummed address', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await kp.createWallet({ subOrgId, curve: 'secp256k1' });
    expect(EvmAddress.safeParse(wallet.address).success).toBe(true);
    expect(wallet.address).toBe(toChecksumAddress(wallet.address.slice(2)));
    expect(wallet.publicKey).toHaveLength(130);
  });

  it('creates a Solana wallet with a base58 address', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await kp.createWallet({ subOrgId, curve: 'ed25519' });
    expect(SolanaAddress.safeParse(wallet.address).success).toBe(true);
  });

  it('produces a verifiable secp256k1 signature over a digest', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await kp.createWallet({ subOrgId, curve: 'secp256k1' });
    const digest = keccak_256(new TextEncoder().encode('hello'));
    const { signature } = await kp.signRaw({
      subOrgId,
      walletId: wallet.walletId,
      payload: digest,
      encoding: 'hash',
    });

    expect(signature).toHaveLength(65);
    const v = signature[64] ?? 0;
    expect([27, 28]).toContain(v);

    const compact = signature.slice(0, 64);
    const publicKey = kp.publicKeyOf(subOrgId, wallet.walletId);
    expect(secp256k1.verify(compact, digest, publicKey, { prehash: false })).toBe(true);
  });

  it('produces a verifiable ed25519 signature over raw bytes', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await kp.createWallet({ subOrgId, curve: 'ed25519' });
    const message = new TextEncoder().encode('gm');
    const { signature } = await kp.signRaw({
      subOrgId,
      walletId: wallet.walletId,
      payload: message,
      encoding: 'raw',
    });
    expect(signature).toHaveLength(64);
    expect(ed25519.verify(signature, message, kp.publicKeyOf(subOrgId, wallet.walletId))).toBe(
      true,
    );
  });

  it('rejects the wrong encoding for each curve', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const evm = await kp.createWallet({ subOrgId, curve: 'secp256k1' });
    await expect(
      kp.signRaw({ subOrgId, walletId: evm.walletId, payload: new Uint8Array(5), encoding: 'raw' }),
    ).rejects.toBeInstanceOf(KeyProviderError);
  });

  it('creates and deletes policies', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const { policyId } = await kp.createPolicy({
      subOrgId,
      policy: { chain: 'evm', expiresIn: '1d', maxValuePerTx: '1000' },
    });
    expect(kp.policiesOf(subOrgId)).toHaveLength(1);
    await kp.deletePolicy({ subOrgId, policyId });
    expect(kp.policiesOf(subOrgId)).toHaveLength(0);
    await expect(kp.deletePolicy({ subOrgId, policyId })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('exports an opaque bundle that never contains the address or key bytes', async () => {
    const { subOrgId } = await kp.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await kp.createWallet({ subOrgId, curve: 'secp256k1' });
    const { encryptedBundle } = await kp.exportWallet({
      subOrgId,
      walletId: wallet.walletId,
      targetPublicKey: 'AAAA',
    });
    expect(typeof encryptedBundle).toBe('string');
    expect(encryptedBundle).not.toContain(wallet.address);
  });

  it('throws not_found for unknown sub-orgs', async () => {
    await expect(kp.createWallet({ subOrgId: 'nope', curve: 'secp256k1' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('MockKeyProvider seeded mode', () => {
  it('re-derives the same wallet after a restart', async () => {
    const before = createMockKeyProvider({ seed: 'local-dev-seed' });
    const { subOrgId } = await before.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const evm = await before.createWallet({ subOrgId, curve: 'secp256k1' });
    const sol = await before.createWallet({ subOrgId, curve: 'ed25519' });
    const digest = keccak_256(new TextEncoder().encode('persist'));
    const sigBefore = await before.signRaw({
      subOrgId,
      walletId: evm.walletId,
      payload: digest,
      encoding: 'hash',
    });

    // Simulates `wrangler dev` restarting: new instance, empty memory, same seed.
    const after = createMockKeyProvider({ seed: 'local-dev-seed' });
    const sigAfter = await after.signRaw({
      subOrgId,
      walletId: evm.walletId,
      payload: digest,
      encoding: 'hash',
    });
    expect(sigAfter).toEqual(sigBefore);
    expect(after.publicKeyOf(subOrgId, sol.walletId)).toEqual(
      before.publicKeyOf(subOrgId, sol.walletId),
    );
  });

  it('derives different keys for different seeds and still refuses malformed ids', async () => {
    const a = createMockKeyProvider({ seed: 'seed-a' });
    const { subOrgId } = await a.createSubOrganization({
      endUserId: 'usr_test',
      auth: { type: 'email', email: 'a@b.co' },
    });
    const wallet = await a.createWallet({ subOrgId, curve: 'secp256k1' });
    const b = createMockKeyProvider({ seed: 'seed-b' });
    expect(b.publicKeyOf(subOrgId, wallet.walletId)).not.toEqual(
      a.publicKeyOf(subOrgId, wallet.walletId),
    );
    await expect(b.createWallet({ subOrgId: 'nope', curve: 'secp256k1' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
