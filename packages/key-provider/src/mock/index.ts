import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { parseEvmTransaction, type ParsedEvmTransaction } from '@pocketkey/chains-evm';
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  inspectTransaction,
  programIds,
  signTransaction as signSolanaTransaction,
  systemTransferLamportsFrom,
  type InspectedTransaction,
} from '@pocketkey/chains-solana';
import type { Curve, SigningPolicy } from '@pocketkey/types';
import { base58, base64 } from '@scure/base';
import { hexToBytes, isHex, parseTransaction, serializeTransaction, toHex, type Hex } from 'viem';
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
  type SignTransactionInput,
  type SignTransactionOutput,
} from '../index.js';

/**
 * Stand-in for Turnkey in tests and local development.
 *
 * It produces real signatures so chain adapters are exercised end to end, which
 * means private keys exist in process memory. That is acceptable only because it
 * never runs in production: `apps/api` refuses `KEY_PROVIDER=mock` there.
 *
 * Two modes:
 * - Unseeded (tests): keys are random and live in memory. Unknown ids are `not_found`.
 * - Seeded (`MOCK_KEY_SEED` in local dev): a key is derived from the seed and the
 *   wallet id, so wallets stored in D1 keep working after a `wrangler dev` restart.
 *
 * Session policies (section 7.4) are enforced like Turnkey would: chain, contract,
 * per transaction value and Solana programs, plus the absolute expiry. They live in
 * memory only, in both modes. A `wrangler dev` restart drops them and the API does
 * not recreate them, so in local dev a session created before a restart fails with
 * `policy_denied` (create a new session). `maxValueTotal` is never enforced here:
 * provider policies are stateless, the API reserves it (DECISIONS.md, phase 4).
 */

interface MockWallet {
  walletId: string;
  curve: Curve;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export interface MockPolicy {
  policyId: string;
  walletId: string;
  policy: SigningPolicy;
  expiresAt: Date;
}

interface MockSubOrg {
  subOrgId: string;
  wallets: Map<string, MockWallet>;
  policies: Map<string, MockPolicy>;
}

const SUB_ORG_ID = /^mockorg_[0-9a-f]{16}$/;
const WALLET_ID = /^mockwlt_(secp256k1|ed25519)_[0-9a-f]{16}$/;

const randomHex = (bytes: number) => bytesToHex(randomBytes(bytes));

const deny = (reason: string): never => {
  throw new KeyProviderError(`Session policy denied: ${reason}`, 'policy_denied');
};

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

function buildWallet(walletId: string, curve: Curve, privateKey: Uint8Array): MockWallet {
  if (curve === 'secp256k1') {
    const publicKey = secp256k1.getPublicKey(privateKey, false);
    return { walletId, curve, privateKey, publicKey, address: evmAddressFromPublicKey(publicKey) };
  }
  const publicKey = ed25519.getPublicKey(privateKey);
  return { walletId, curve, privateKey, publicKey, address: base58.encode(publicKey) };
}

/** 65 bytes r || s || v (v in {27, 28}) over a 32-byte digest. */
function signDigest(wallet: MockWallet, digest: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(digest, wallet.privateKey, { prehash: false, format: 'recovered' });
  // noble returns recovery byte first (recid || r || s); EVM wants r || s || v.
  const recid = sig[0] ?? 0;
  const signature = new Uint8Array(65);
  signature.set(sig.slice(1), 0);
  signature[64] = 27 + recid;
  return signature;
}

/** Throws `policy_denied` unless the parsed EVM transaction satisfies the policy. */
export function enforceEvmPolicy(policy: SigningPolicy, tx: ParsedEvmTransaction): void {
  if (policy.chain !== 'evm') deny('policy is not an EVM policy');
  if (policy.allowedChains && !policy.allowedChains.some((id) => id === tx.chainId)) {
    deny(`chain ${tx.chainId} is not allowed`);
  }
  if (policy.allowedContracts) {
    if (tx.to === null) deny('contract creation is not allowed with a contract allowlist');
    const to = tx.to?.toLowerCase();
    if (!policy.allowedContracts.some((address) => address.toLowerCase() === to)) {
      deny(`contract ${tx.to ?? ''} is not allowed`);
    }
  }
  if (policy.maxValuePerTx !== undefined && tx.value > BigInt(policy.maxValuePerTx)) {
    deny('value exceeds maxValuePerTx');
  }
}

/** Throws `policy_denied` unless the inspected Solana transaction satisfies the policy. */
export function enforceSolanaPolicy(
  policy: SigningPolicy,
  tx: InspectedTransaction,
  walletAddress: string,
): void {
  if (policy.chain !== 'solana') deny('policy is not a Solana policy');
  if (policy.allowedPrograms) {
    const allowed = new Set<string>([...policy.allowedPrograms, COMPUTE_BUDGET_PROGRAM_ID]);
    const refused = programIds(tx).find((programId) => !allowed.has(programId));
    if (refused !== undefined) deny(`program ${refused} is not allowed`);
  }
  if (
    policy.maxValuePerTx !== undefined &&
    systemTransferLamportsFrom(tx, walletAddress) > BigInt(policy.maxValuePerTx)
  ) {
    deny('value exceeds maxValuePerTx');
  }
}

export interface MockKeyProviderOptions {
  /** Enables deterministic keys that survive restarts. Local development only. */
  seed?: string;
  /** Clock used for policy expiry. Tests only. */
  now?: () => Date;
}

export class MockKeyProvider implements KeyProvider {
  private readonly subOrgs = new Map<string, MockSubOrg>();
  private readonly seed: Uint8Array | undefined;
  private readonly now: () => Date;

  constructor(options: MockKeyProviderOptions = {}) {
    this.seed = options.seed ? utf8ToBytes(options.seed) : undefined;
    this.now = options.now ?? (() => new Date());
  }

  /** Test helper: number of sub-orgs known in memory. */
  get size(): number {
    return this.subOrgs.size;
  }

  reset(): void {
    this.subOrgs.clear();
  }

  async createSubOrganization(_input: CreateSubOrganizationInput): Promise<{ subOrgId: string }> {
    const subOrgId = `mockorg_${randomHex(8)}`;
    this.subOrgs.set(subOrgId, { subOrgId, wallets: new Map(), policies: new Map() });
    return { subOrgId };
  }

  async createWallet(input: CreateWalletInput): Promise<CreateWalletOutput> {
    const subOrg = this.getSubOrg(input.subOrgId);
    const walletId = `mockwlt_${input.curve}_${randomHex(8)}`;
    const privateKey = this.seed
      ? this.derivePrivateKey(walletId, input.curve)
      : input.curve === 'secp256k1'
        ? secp256k1.utils.randomSecretKey()
        : randomBytes(32);

    const wallet = buildWallet(walletId, input.curve, privateKey);
    subOrg.wallets.set(walletId, wallet);
    return { walletId, address: wallet.address, publicKey: bytesToHex(wallet.publicKey) };
  }

  async signRaw(input: SignRawInput): Promise<SignRawOutput> {
    const wallet = this.getWallet(input.subOrgId, input.walletId);
    if (input.sessionPolicyId !== undefined) {
      const record = this.requirePolicy(input.subOrgId, input.walletId, input.sessionPolicyId);
      // Mirrors the Turnkey mapping: raw payloads only when the user allowed messages.
      if (record.policy.allowMessages !== true)
        deny('raw payload signing is not allowed by this policy');
    }

    if (wallet.curve === 'secp256k1') {
      if (input.encoding !== 'hash' || input.payload.length !== 32) {
        throw new KeyProviderError('secp256k1 expects a 32-byte digest', 'invalid_input');
      }
      return { signature: signDigest(wallet, input.payload) };
    }

    if (input.encoding !== 'raw') {
      throw new KeyProviderError('ed25519 signs raw bytes only', 'invalid_input');
    }
    return { signature: ed25519.sign(input.payload, wallet.privateKey) };
  }

  async signTransaction(input: SignTransactionInput): Promise<SignTransactionOutput> {
    const wallet = this.getWallet(input.subOrgId, input.walletId);
    const policy =
      input.sessionPolicyId === undefined
        ? undefined
        : this.requirePolicy(input.subOrgId, input.walletId, input.sessionPolicyId).policy;

    if (input.chainFamily === 'evm') {
      if (wallet.curve !== 'secp256k1') {
        throw new KeyProviderError('EVM transactions need a secp256k1 wallet', 'invalid_input');
      }
      return { signedTransaction: this.signEvm(wallet, input.unsignedTransaction, policy) };
    }

    if (wallet.curve !== 'ed25519') {
      throw new KeyProviderError('Solana transactions need an ed25519 wallet', 'invalid_input');
    }
    let inspected: InspectedTransaction;
    try {
      inspected = inspectTransaction(input.unsignedTransaction);
    } catch (cause) {
      throw new KeyProviderError('Malformed Solana transaction', 'invalid_input', { cause });
    }
    if (policy) enforceSolanaPolicy(policy, inspected, wallet.address);

    try {
      const signedTransaction = await signSolanaTransaction(input.unsignedTransaction, {
        publicKey: wallet.address,
        signBytes: async (bytes) => ed25519.sign(bytes, wallet.privateKey),
      });
      return { signedTransaction };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not sign the transaction';
      throw new KeyProviderError(message, 'invalid_input', { cause });
    }
  }

  async createPolicy(input: CreatePolicyInput): Promise<{ policyId: string }> {
    const subOrg = this.getSubOrg(input.subOrgId);
    const wallet = this.getWallet(input.subOrgId, input.walletId);
    const expected = input.policy.chain === 'evm' ? 'secp256k1' : 'ed25519';
    if (wallet.curve !== expected) {
      throw new KeyProviderError(
        `A ${input.policy.chain} policy cannot target a ${wallet.curve} wallet`,
        'invalid_input',
      );
    }
    const policyId = `mockpol_${randomHex(8)}`;
    subOrg.policies.set(policyId, {
      policyId,
      walletId: input.walletId,
      policy: input.policy,
      expiresAt: new Date(input.expiresAt.getTime()),
    });
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
    // The real provider encrypts key material to `targetPublicKey`. The mock
    // returns an opaque marker so the export flow can be exercised without ever
    // emitting bytes that look like a key.
    const bundle = base64.encode(
      new TextEncoder().encode(
        JSON.stringify({ mock: true, walletId: input.walletId, to: input.targetPublicKey }),
      ),
    );
    return { encryptedBundle: bundle };
  }

  /** Test helper: policies attached to a sub-org. */
  policiesOf(subOrgId: string): SigningPolicy[] {
    return this.policyRecordsOf(subOrgId).map((record) => record.policy);
  }

  /** Test helper: policies with their wallet and expiry. */
  policyRecordsOf(subOrgId: string): MockPolicy[] {
    return [...this.getSubOrg(subOrgId).policies.values()];
  }

  /** Test helper: public key bytes for signature verification in tests. */
  publicKeyOf(subOrgId: string, walletId: string): Uint8Array {
    return this.getWallet(subOrgId, walletId).publicKey;
  }

  private signEvm(wallet: MockWallet, unsigned: string, policy: SigningPolicy | undefined): Hex {
    if (!isHex(unsigned, { strict: true })) {
      throw new KeyProviderError('EVM transaction must be 0x-prefixed hex', 'invalid_input');
    }
    let parsed: ParsedEvmTransaction;
    let serializable: ReturnType<typeof parseTransaction>;
    try {
      parsed = parseEvmTransaction(unsigned);
      serializable = parseTransaction(unsigned);
    } catch (cause) {
      throw new KeyProviderError('Malformed EVM transaction', 'invalid_input', { cause });
    }
    if (parsed.signed || serializable.type !== 'eip1559') {
      throw new KeyProviderError('Expected an unsigned EIP-1559 transaction', 'invalid_input');
    }
    if (policy) enforceEvmPolicy(policy, parsed);

    const signature = signDigest(wallet, keccak_256(hexToBytes(unsigned)));
    return serializeTransaction(serializable, {
      r: toHex(signature.slice(0, 32)),
      s: toHex(signature.slice(32, 64)),
      yParity: (signature[64] ?? 27) - 27,
    });
  }

  private requirePolicy(subOrgId: string, walletId: string, policyId: string): MockPolicy {
    const record = this.getSubOrg(subOrgId).policies.get(policyId);
    if (!record) return deny('policy not found');
    if (record.walletId !== walletId) deny('policy is attached to another wallet');
    if (this.now().getTime() >= record.expiresAt.getTime()) deny('policy expired');
    return record;
  }

  private derivePrivateKey(walletId: string, curve: Curve): Uint8Array {
    if (!this.seed) throw new KeyProviderError('Seed required', 'invalid_input');
    // HMAC-SHA256(seed, walletId || counter). Retry in the negligible case the
    // digest is not a valid secp256k1 scalar.
    for (let counter = 0; counter < 16; counter++) {
      const candidate = hmac(sha256, this.seed, utf8ToBytes(`${walletId}:${counter}`));
      if (curve === 'ed25519' || secp256k1.utils.isValidSecretKey(candidate)) return candidate;
    }
    throw new KeyProviderError('Could not derive a valid key', 'unknown');
  }

  private getSubOrg(subOrgId: string): MockSubOrg {
    const known = this.subOrgs.get(subOrgId);
    if (known) return known;
    if (this.seed && SUB_ORG_ID.test(subOrgId)) {
      const rehydrated: MockSubOrg = { subOrgId, wallets: new Map(), policies: new Map() };
      this.subOrgs.set(subOrgId, rehydrated);
      return rehydrated;
    }
    throw new KeyProviderError(`Sub-organization ${subOrgId} not found`, 'not_found');
  }

  private getWallet(subOrgId: string, walletId: string): MockWallet {
    const subOrg = this.getSubOrg(subOrgId);
    const known = subOrg.wallets.get(walletId);
    if (known) return known;
    const match = this.seed ? WALLET_ID.exec(walletId) : null;
    const curve = match?.[1];
    if (curve === 'secp256k1' || curve === 'ed25519') {
      const wallet = buildWallet(walletId, curve, this.derivePrivateKey(walletId, curve));
      subOrg.wallets.set(walletId, wallet);
      return wallet;
    }
    throw new KeyProviderError(`Wallet ${walletId} not found`, 'not_found');
  }
}

export function createMockKeyProvider(options: MockKeyProviderOptions = {}): MockKeyProvider {
  return new MockKeyProvider(options);
}
