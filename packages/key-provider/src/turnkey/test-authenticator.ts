import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

/**
 * Software passkey for tests: P-256 key, "none" attestation, real signatures.
 * Produces the JSON the iframe gets from `navigator.credentials`.
 */

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 256) return Uint8Array.of((major << 5) | 24, length);
  return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
}

function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concatBytes(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concatBytes(head(2, value.length), value);
  const entries = [...value].map(([k, v]) => concatBytes(cbor(k), cbor(v)));
  return concatBytes(head(5, value.size), ...entries);
}

const b64url = (bytes: Uint8Array) => base64urlnopad.encode(bytes);
const utf8 = (text: string) => new TextEncoder().encode(text);

export class TestAuthenticator {
  private readonly secretKey = p256.utils.randomSecretKey();
  private readonly rawId = crypto.getRandomValues(new Uint8Array(32));
  private counter = 0;

  constructor(
    private readonly rpId = 'embed.pocketkey.test',
    private readonly origin = 'https://embed.pocketkey.test',
  ) {}

  get credentialId(): string {
    return b64url(this.rawId);
  }

  private count(): Uint8Array {
    this.counter += 1;
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, this.counter);
    return out;
  }

  private clientData(type: string, challenge: Uint8Array): Uint8Array {
    return utf8(
      JSON.stringify({
        type,
        challenge: b64url(challenge),
        origin: this.origin,
        crossOrigin: false,
      }),
    );
  }

  /** Attestation for `buildAddPasskey`. */
  register(challenge: Uint8Array) {
    const publicKey = p256.getPublicKey(this.secretKey, false);
    const coseKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, publicKey.slice(1, 33)],
        [-3, publicKey.slice(33, 65)],
      ]),
    );
    const authData = concatBytes(
      sha256(utf8(this.rpId)),
      Uint8Array.of(0x45),
      this.count(),
      new Uint8Array(16),
      Uint8Array.of(0, this.rawId.length),
      this.rawId,
      coseKey,
    );
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      challenge: b64url(challenge),
      attestation: {
        credentialId: this.credentialId,
        clientDataJson: b64url(this.clientData('webauthn.create', challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['AUTHENTICATOR_TRANSPORT_INTERNAL'],
      },
    };
  }

  /** Assertion fields for `webauthnStamp`. */
  assert(challenge: Uint8Array) {
    const authData = concatBytes(sha256(utf8(this.rpId)), Uint8Array.of(0x05), this.count());
    const clientData = this.clientData('webauthn.get', challenge);
    const signature = p256.sign(concatBytes(authData, sha256(clientData)), this.secretKey, {
      format: 'der',
    });
    return {
      credentialId: this.credentialId,
      clientDataJson: b64url(clientData),
      authenticatorData: b64url(authData),
      signature: b64url(signature),
    };
  }
}
