import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64urlnopad } from '@scure/base';

/**
 * A minimal software authenticator for tests: P-256 key, "none" attestation,
 * real signatures. Enough for SimpleWebAuthn (inside Better Auth) to verify
 * registration and authentication end to end without a browser.
 */

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 256) return Uint8Array.of((major << 5) | 24, length);
  if (length < 65536) return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
  throw new Error('CBOR value too large for this encoder');
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  const entries = [...value].map(([k, v]) => concat(cbor(k), cbor(v)));
  return concat(head(5, value.size), ...entries);
}

const b64url = (bytes: Uint8Array) => base64urlnopad.encode(bytes);
const utf8 = (text: string) => new TextEncoder().encode(text);

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftwareAuthenticator {
  private readonly secretKey = p256.utils.randomSecretKey();
  private readonly credentialId = crypto.getRandomValues(new Uint8Array(32));
  private counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  private rpIdHash(): Uint8Array {
    return sha256(utf8(this.rpId));
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string): Uint8Array {
    return utf8(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  private counterBytes(): Uint8Array {
    this.counter += 1;
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, this.counter);
    return out;
  }

  /** RegistrationResponseJSON for `navigator.credentials.create`. */
  register(challenge: string) {
    const publicKey = p256.getPublicKey(this.secretKey, false);
    const coseKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, publicKey.slice(1, 33)],
        [-3, publicKey.slice(33, 65)],
      ]),
    );
    const idLength = Uint8Array.of(this.credentialId.length >> 8, this.credentialId.length & 0xff);
    const authData = concat(
      this.rpIdHash(),
      Uint8Array.of(FLAG_UP | FLAG_UV | FLAG_AT),
      this.counterBytes(),
      new Uint8Array(16), // aaguid
      idLength,
      this.credentialId,
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
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  /** AuthenticationResponseJSON for `navigator.credentials.get`. */
  authenticate(challenge: string) {
    const authData = concat(this.rpIdHash(), Uint8Array.of(FLAG_UP | FLAG_UV), this.counterBytes());
    const clientData = this.clientData('webauthn.get', challenge);
    const signature = p256.sign(concat(authData, sha256(clientData)), this.secretKey, {
      format: 'der',
    });
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
    };
  }
}
