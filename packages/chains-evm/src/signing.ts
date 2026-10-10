import {
  bytesToHex,
  getAddress,
  hashMessage,
  hashTypedData,
  hexToBytes,
  isHex,
  type Hex,
  type SignableMessage,
  type TypedDataDefinition,
  type TypedDataDomain,
} from 'viem';
import type { SignTypedDataInput } from '@pockey/types';

/**
 * Signs a 32-byte digest. Implemented by the caller (the API wires it to
 * `KeyProvider.signRaw`). Must return a 65-byte `r || s || v` signature as
 * 0x-hex, with `v` in {27, 28}.
 */
export type SignHash = (hash: Hex) => Promise<Hex>;

/** Converts a raw 65-byte `r || s || v` signature to 0x-hex. Throws on any other length. */
export function signatureToHex(signature: Uint8Array): Hex {
  if (signature.length !== 65) {
    throw new Error(`Expected a 65-byte signature, got ${signature.length} bytes`);
  }
  return bytesToHex(signature);
}

/**
 * Validates a signer output and normalizes `v` to {27, 28}.
 * Some signers return a recovery id in {0, 1}; both forms are accepted.
 */
export function normalizeSignature(signature: Hex): Hex {
  if (!isHex(signature, { strict: true })) {
    throw new Error('Signer returned a non-hex signature');
  }
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) {
    throw new Error(`Signer returned a ${bytes.length}-byte signature, expected 65`);
  }
  const v = bytes[64] ?? 0;
  if (v === 0 || v === 1) {
    bytes[64] = v + 27;
  } else if (v !== 27 && v !== 28) {
    throw new Error(`Signer returned an invalid recovery byte ${v}`);
  }
  return bytesToHex(bytes);
}

/** EIP-191 personal_sign digest. */
export function hashPersonalMessage(message: string | { raw: Hex }): Hex {
  return hashMessage(message satisfies SignableMessage);
}

function toViemDomain(domain: SignTypedDataInput['domain']): TypedDataDomain {
  const out: TypedDataDomain = {};
  if (domain.name !== undefined) out.name = domain.name;
  if (domain.version !== undefined) out.version = domain.version;
  if (domain.chainId !== undefined) out.chainId = domain.chainId;
  if (domain.verifyingContract !== undefined) {
    out.verifyingContract = getAddress(domain.verifyingContract);
  }
  if (domain.salt !== undefined) {
    if (!isHex(domain.salt, { strict: true })) throw new Error('Typed data salt must be hex');
    out.salt = domain.salt;
  }
  return out;
}

type LooseTypedData = TypedDataDefinition<Record<string, unknown>, string>;

function toTypedDataDefinition(input: SignTypedDataInput): LooseTypedData {
  return {
    domain: toViemDomain(input.domain),
    types: input.types,
    primaryType: input.primaryType,
    message: input.message,
  };
}

/** EIP-712 digest of a Pockey typed data payload. */
export function hashTypedDataInput(input: SignTypedDataInput): Hex {
  return hashTypedData(toTypedDataDefinition(input));
}

export async function signPersonalMessage(
  message: string | { raw: Hex },
  signHash: SignHash,
): Promise<Hex> {
  return normalizeSignature(await signHash(hashPersonalMessage(message)));
}

export async function signTypedDataInput(
  input: SignTypedDataInput,
  signHash: SignHash,
): Promise<Hex> {
  return normalizeSignature(await signHash(hashTypedDataInput(input)));
}
