import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

/**
 * Just enough WebAuthn for the emulator: read the ES256 public key out of a "none"
 * attestation, and verify an `X-Stamp-WebAuthn` assertion over a request body the
 * way Turnkey does (challenge = UTF-8 bytes of hex(SHA-256(body))).
 */

type Cbor = number | bigint | string | Uint8Array | boolean | null | Cbor[] | Map<Cbor, Cbor>;

function decodeCbor(bytes: Uint8Array): { value: Cbor; offset: number } {
  const read = (offset: number): { value: Cbor; offset: number } => {
    const initial = bytes[offset];
    if (initial === undefined) throw new Error('Truncated CBOR');
    const major = initial >> 5;
    const info = initial & 0x1f;
    let length: number;
    let next = offset + 1;
    if (info < 24) length = info;
    else if (info === 24) length = bytes[next++] ?? 0;
    else if (info === 25) {
      length = ((bytes[next] ?? 0) << 8) | (bytes[next + 1] ?? 0);
      next += 2;
    } else if (info === 26) {
      length = new DataView(bytes.buffer, bytes.byteOffset + next, 4).getUint32(0);
      next += 4;
    } else if (major === 7 && (info === 20 || info === 21 || info === 22)) {
      return { value: info === 20 ? false : info === 21 ? true : null, offset: next };
    } else throw new Error('Unsupported CBOR');
    switch (major) {
      case 0:
        return { value: length, offset: next };
      case 1:
        return { value: -1 - length, offset: next };
      case 2:
        return { value: bytes.slice(next, next + length), offset: next + length };
      case 3:
        return {
          value: new TextDecoder().decode(bytes.slice(next, next + length)),
          offset: next + length,
        };
      case 4: {
        const items: Cbor[] = [];
        for (let i = 0; i < length; i++) {
          const item = read(next);
          items.push(item.value);
          next = item.offset;
        }
        return { value: items, offset: next };
      }
      case 5: {
        const map = new Map<Cbor, Cbor>();
        for (let i = 0; i < length; i++) {
          const key = read(next);
          const value = read(key.offset);
          map.set(key.value, value.value);
          next = value.offset;
        }
        return { value: map, offset: next };
      }
      default:
        throw new Error('Unsupported CBOR major type');
    }
  };
  return read(0);
}

const b64 = (value: string) => base64urlnopad.decode(value.replace(/=+$/, ''));

/** Uncompressed P-256 public key (hex) of the credential in a registration attestation. */
export function publicKeyFromAttestation(attestationObject: string): {
  credentialId: string;
  publicKey: string;
} {
  const decoded = decodeCbor(b64(attestationObject)).value;
  if (!(decoded instanceof Map)) throw new Error('Malformed attestation');
  const authData = decoded.get('authData');
  if (!(authData instanceof Uint8Array)) throw new Error('Malformed attestation');
  // rpIdHash (32) flags (1) counter (4) aaguid (16) credIdLen (2) credId coseKey
  const idLength = ((authData[53] ?? 0) << 8) | (authData[54] ?? 0);
  const credentialId = authData.slice(55, 55 + idLength);
  const cose = decodeCbor(authData.slice(55 + idLength)).value;
  if (!(cose instanceof Map)) throw new Error('Malformed credential key');
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
    throw new Error('Only ES256 credentials are supported');
  }
  return {
    credentialId: base64urlnopad.encode(credentialId),
    publicKey: bytesToHex(concatBytes(Uint8Array.of(4), x, y)),
  };
}

export interface WebAuthnStamp {
  credentialId: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
}

/** Verifies an assertion over `body` with the stored public key. */
export function verifyWebAuthnStamp(
  body: string,
  stamp: WebAuthnStamp,
  publicKey: string,
): boolean {
  try {
    const clientData = JSON.parse(new TextDecoder().decode(b64(stamp.clientDataJson))) as {
      type?: string;
      challenge?: string;
    };
    const expected = base64urlnopad.encode(
      new TextEncoder().encode(bytesToHex(sha256(new TextEncoder().encode(body)))),
    );
    if (clientData.type !== 'webauthn.get' || clientData.challenge !== expected) return false;
    const signed = concatBytes(b64(stamp.authenticatorData), sha256(b64(stamp.clientDataJson)));
    return p256.verify(b64(stamp.signature), signed, hexToBytes(publicKey), {
      format: 'der',
      lowS: false,
    });
  } catch {
    return false;
  }
}
