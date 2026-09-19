import { p256 } from '@noble/curves/nist.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, randomBytes } from '@noble/hashes/utils.js';

/**
 * HPKE (RFC 9180, DHKEM P-256 + HKDF-SHA256 + AES-256-GCM, base mode) exactly as
 * Turnkey's enclaves and `@turnkey/crypto` implement it, including their additional
 * data (sender public key || receiver public key, both uncompressed).
 *
 * Ported from `@turnkey/crypto` 2.13 (Apache-2.0) because that package pulls `borsh`,
 * which breaks the Workers test pool. Used by the emulator only; interop with the
 * real library is covered by `hpke.test.ts`.
 */

const HPKE_VERSION = new Uint8Array([72, 80, 75, 69, 45, 118, 49]); // "HPKE-v1"
const SUITE_KEM = new Uint8Array([75, 69, 77, 0, 16]); // "KEM" || 0x0010
const SUITE_HPKE = new Uint8Array([72, 80, 75, 69, 0, 16, 0, 1, 0, 2]); // "HPKE" || kem || kdf || aead
const LABEL_EAE_PRK = new TextEncoder().encode('eae_prk');
const LABEL_SHARED_SECRET = new TextEncoder().encode('shared_secret');
const LABEL_SECRET = new TextEncoder().encode('secret');
// Key schedule contexts for base mode with empty psk id and info, as fixed by Turnkey.
const KEY_SCHEDULE_CONTEXT = hexToBytes(
  '008fc3aeb832490a4b5ab3e42023287db29a1f4bc7c222c0df228727b70a4021122f3f04e9206cd12413503529b47ac6a630b92ec4cf7d234508d0af9771c99e50',
);
const AES_KEY_INFO = concatBytes(
  new Uint8Array([0, 32]),
  HPKE_VERSION,
  SUITE_HPKE,
  new TextEncoder().encode('key'),
  KEY_SCHEDULE_CONTEXT,
);
const IV_INFO = concatBytes(
  new Uint8Array([0, 12]),
  HPKE_VERSION,
  SUITE_HPKE,
  new TextEncoder().encode('base_nonce'),
  KEY_SCHEDULE_CONTEXT,
);

const labeledIkm = (label: Uint8Array, ikm: Uint8Array, suite: Uint8Array) =>
  concatBytes(HPKE_VERSION, suite, label, ikm);

const labeledInfo = (label: Uint8Array, info: Uint8Array, suite: Uint8Array, length: number) =>
  concatBytes(new Uint8Array([0, length]), HPKE_VERSION, suite, label, info);

const extractAndExpand = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) =>
  expand(sha256, extract(sha256, ikm, salt), info, length);

function schedule(sharedPoint: Uint8Array, encapped: Uint8Array, receiverPublic: Uint8Array) {
  const dh = sharedPoint.slice(1);
  const kemContext = concatBytes(encapped, receiverPublic);
  const sharedSecret = extractAndExpand(
    new Uint8Array(),
    labeledIkm(LABEL_EAE_PRK, dh, SUITE_KEM),
    labeledInfo(LABEL_SHARED_SECRET, kemContext, SUITE_KEM, 32),
    32,
  );
  const secretIkm = labeledIkm(LABEL_SECRET, new Uint8Array(), SUITE_HPKE);
  return {
    key: extractAndExpand(sharedSecret, secretIkm, AES_KEY_INFO, 32),
    iv: extractAndExpand(sharedSecret, secretIkm, IV_INFO, 12),
  };
}

async function aesGcm(
  mode: 'encrypt' | 'decrypt',
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  // Copies: WebCrypto wants ArrayBuffer backed views, noble may hand out shared ones.
  const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, [
    mode,
  ]);
  const params = {
    name: 'AES-GCM',
    iv: new Uint8Array(iv),
    additionalData: new Uint8Array(aad),
    tagLength: 128,
  };
  const out =
    mode === 'encrypt'
      ? await crypto.subtle.encrypt(params, cryptoKey, new Uint8Array(data))
      : await crypto.subtle.decrypt(params, cryptoKey, new Uint8Array(data));
  return new Uint8Array(out);
}

export interface HpkeCiphertext {
  /** Uncompressed ephemeral sender public key, hex. */
  encappedPublic: string;
  ciphertext: string;
}

/** Encrypts to an uncompressed (or compressed) P-256 public key. */
export async function hpkeEncrypt(
  plaintext: Uint8Array,
  receiverPublicKey: Uint8Array,
): Promise<HpkeCiphertext> {
  const receiver = p256.Point.fromBytes(receiverPublicKey).toBytes(false);
  const senderSecret = p256.utils.randomSecretKey();
  const encapped = p256.getPublicKey(senderSecret, false);
  const { key, iv } = schedule(p256.getSharedSecret(senderSecret, receiver), encapped, receiver);
  const ciphertext = await aesGcm('encrypt', key, iv, concatBytes(encapped, receiver), plaintext);
  return { encappedPublic: bytesToHex(encapped), ciphertext: bytesToHex(ciphertext) };
}

export async function hpkeDecrypt(
  input: HpkeCiphertext,
  receiverSecretKey: Uint8Array,
): Promise<Uint8Array> {
  const encapped = hexToBytes(input.encappedPublic);
  const receiver = p256.getPublicKey(receiverSecretKey, false);
  const { key, iv } = schedule(
    p256.getSharedSecret(receiverSecretKey, encapped),
    encapped,
    receiver,
  );
  return aesGcm('decrypt', key, iv, concatBytes(encapped, receiver), hexToBytes(input.ciphertext));
}

/* Enclave signed bundles: { enclaveQuorumPublic, dataSignature, data } with data a
   hex encoded JSON document and the signature ECDSA P-256 (DER) over SHA-256(data). */

export interface EnclaveBundle {
  version?: string;
  enclaveQuorumPublic: string;
  dataSignature: string;
  data: string;
}

export function signEnclaveBundle(
  document: Record<string, unknown>,
  signerSecretKey: Uint8Array,
): string {
  const data = new TextEncoder().encode(JSON.stringify(document));
  const signature = p256.sign(sha256(data), signerSecretKey, { prehash: false, format: 'der' });
  const bundle: EnclaveBundle = {
    version: 'v1.0.0',
    enclaveQuorumPublic: bytesToHex(p256.getPublicKey(signerSecretKey, false)),
    dataSignature: bytesToHex(signature),
    data: bytesToHex(data),
  };
  return JSON.stringify(bundle);
}

export function randomSecretKey(): Uint8Array {
  return p256.utils.randomSecretKey();
}

export { randomBytes };
