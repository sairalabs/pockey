import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { base58, base64 } from '@scure/base';
import type { Curve, SigningPolicy } from '@pocketkey/types';
import {
  KeyProviderError,
  type CreatePolicyInput,
  type CreateSubOrganizationInput,
  type CreateWalletInput,
  type CreateWalletOutput,
  type ExportWalletInput,
  type KeyProvider,
  type SignRawInput,
  type SignRawOutput,
} from '../index.js';

/**
 * In-memory key provider for tests and local development.
 *
 * It produces real signatures so chain adapters can be exercised end to end,
 * which means it holds private keys in process memory. That is acceptable only
 * because it never runs in a deployed environment: `apps/api` refuses to
 * instantiate it unless `KEY_PROVIDER=mock`.
 */

interface MockWallet {
  walletId: string;
  curve: Curve;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

interface MockSubOrg {
  subOrgId: string;
  endUserId: string;
  wallets: Map<string, MockWallet>;
  policies: Map<string, SigningPolicy>;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(6, '0')}`;

function evmAddressFromPublicKey(uncompressed: Uint8Array): string {
  // Drop the 0x04 prefix, keccak the 64 remaining bytes, keep the last 20.
  const hash = keccak_256(uncompressed.slice(1));
  return toChecksumAddress(bytesToHex(hash.slice(-20)));
}

/** EIP-55 checksum. */
export function toChecksumAddress(hexNoPrefix: string): string {
  const lower = hexNoPrefix.toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i] ?? '';
    const nibble = parseInt(hash[i] ?? '0', 16);
    out += nibble >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

export class MockKeyProvider implements KeyProvider {
  private readonly subOrgs = new Map<string, MockSubOrg>();

  /** Test helper: number of sub-orgs created so far. */
  get size(): number {
    return this.subOrgs.size;
  }

  reset(): void {
    this.subOrgs.clear();
  }

  async createSubOrganization(input: CreateSubOrganizationInput): Promise<{ subOrgId: string }> {
    const subOrgId = nextId('suborg');
    this.subOrgs.set(subOrgId, {
      subOrgId,
      endUserId: input.endUserId,
      wallets: new Map(),
      policies: new Map(),
    });
    return { subOrgId };
  }

  async createWallet(input: CreateWalletInput): Promise<CreateWalletOutput> {
    const subOrg = this.getSubOrg(input.subOrgId);
    const walletId = nextId('wallet');
    const privateKey = randomBytes(32);

    let wallet: MockWallet;
    if (input.curve === 'secp256k1') {
      const publicKey = secp256k1.getPublicKey(privateKey, false);
      wallet = {
        walletId,
        curve: input.curve,
        privateKey,
        publicKey,
        address: evmAddressFromPublicKey(publicKey),
      };
    } else {
      const publicKey = ed25519.getPublicKey(privateKey);
      wallet = {
        walletId,
        curve: input.curve,
        privateKey,
        publicKey,
        address: base58.encode(publicKey),
      };
    }

    subOrg.wallets.set(walletId, wallet);
    return {
      walletId,
      address: wallet.address,
      publicKey: bytesToHex(wallet.publicKey),
    };
  }

  async signRaw(input: SignRawInput): Promise<SignRawOutput> {
    const wallet = this.getWallet(input.subOrgId, input.walletId);

    if (wallet.curve === 'secp256k1') {
      if (input.encoding !== 'hash' || input.payload.length !== 32) {
        throw new KeyProviderError('secp256k1 expects a 32-byte digest', 'invalid_input');
      }
      const sig = secp256k1.sign(input.payload, wallet.privateKey, {
        prehash: false,
        format: 'recovered',
      });
      // noble returns recovery byte first (recid || r || s); EVM wants r || s || v.
      const recid = sig[0] ?? 0;
      const signature = new Uint8Array(65);
      signature.set(sig.slice(1), 0);
      signature[64] = 27 + recid;
      return { signature };
    }

    if (input.encoding !== 'raw') {
      throw new KeyProviderError('ed25519 signs raw bytes only', 'invalid_input');
    }
    return { signature: ed25519.sign(input.payload, wallet.privateKey) };
  }

  async createPolicy(input: CreatePolicyInput): Promise<{ policyId: string }> {
    const subOrg = this.getSubOrg(input.subOrgId);
    const policyId = nextId('policy');
    subOrg.policies.set(policyId, input.policy);
    return { policyId };
  }

  async deletePolicy(input: { subOrgId: string; policyId: string }): Promise<void> {
    const subOrg = this.getSubOrg(input.subOrgId);
    if (!subOrg.policies.delete(input.policyId)) {
      throw new KeyProviderError(`Policy ${input.policyId} not found`, 'not_found');
    }
  }

  async exportWallet(input: ExportWalletInput): Promise<{ encryptedBundle: string }> {
    this.getWallet(input.subOrgId, input.walletId);
    // The real provider encrypts the key material to `targetPublicKey`.
    // The mock returns an opaque bundle so the export flow can be exercised
    // without ever exposing bytes that look like a key.
    const bundle = base64.encode(
      new TextEncoder().encode(
        JSON.stringify({ mock: true, walletId: input.walletId, to: input.targetPublicKey }),
      ),
    );
    return { encryptedBundle: bundle };
  }

  /** Test helper: policies attached to a sub-org. */
  policiesOf(subOrgId: string): SigningPolicy[] {
    return [...this.getSubOrg(subOrgId).policies.values()];
  }

  /** Test helper: public key bytes for signature verification in tests. */
  publicKeyOf(subOrgId: string, walletId: string): Uint8Array {
    return this.getWallet(subOrgId, walletId).publicKey;
  }

  private getSubOrg(subOrgId: string): MockSubOrg {
    const subOrg = this.subOrgs.get(subOrgId);
    if (!subOrg) throw new KeyProviderError(`Sub-organization ${subOrgId} not found`, 'not_found');
    return subOrg;
  }

  private getWallet(subOrgId: string, walletId: string): MockWallet {
    const wallet = this.getSubOrg(subOrgId).wallets.get(walletId);
    if (!wallet) throw new KeyProviderError(`Wallet ${walletId} not found`, 'not_found');
    return wallet;
  }
}

export function createMockKeyProvider(): MockKeyProvider {
  return new MockKeyProvider();
}
