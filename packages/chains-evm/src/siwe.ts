import {
  getAddress,
  hexToBytes,
  isAddressEqual,
  isHex,
  recoverMessageAddress,
  type Address,
  type Hex,
} from 'viem';
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe';

/**
 * Verifies an EIP-4361 (Sign-In With Ethereum) login offline.
 * EOA signatures only (no EIP-1271). Returns null on any mismatch and never throws.
 */
export async function verifySiweLogin(options: {
  message: string;
  signature: Hex;
  expectedNonce: string;
  expectedDomain?: string;
  now?: Date;
}): Promise<{ address: Address; chainId: number } | null> {
  try {
    const { message, signature, expectedNonce, expectedDomain, now = new Date() } = options;
    if (typeof message !== 'string' || expectedNonce.length === 0) return null;

    const parsed = parseSiweMessage(message);
    if (
      parsed.address === undefined ||
      parsed.domain === undefined ||
      parsed.nonce === undefined ||
      parsed.uri === undefined ||
      parsed.chainId === undefined ||
      parsed.version !== '1'
    ) {
      return null;
    }
    if (parsed.issuedAt !== undefined && Number.isNaN(parsed.issuedAt.getTime())) return null;

    const valid = validateSiweMessage({
      message: parsed,
      nonce: expectedNonce,
      domain: expectedDomain,
      time: now,
    });
    // validateSiweMessage skips the domain check on an empty string; treat it as a mismatch.
    if (!valid || expectedDomain === '') return null;

    if (typeof signature !== 'string' || !isHex(signature, { strict: true })) return null;
    if (hexToBytes(signature).length !== 65) return null;

    const recovered = await recoverMessageAddress({ message, signature });
    if (!isAddressEqual(recovered, parsed.address)) return null;

    return { address: getAddress(parsed.address), chainId: parsed.chainId };
  } catch {
    return null;
  }
}

/** Builds an EIP-4361 message. `issuedAt` defaults to now. */
export function buildSiweMessage(options: {
  domain: string;
  uri: string;
  address: Address;
  chainId: number;
  nonce: string;
  statement?: string;
  issuedAt?: Date;
  expirationTime?: Date;
}): string {
  return createSiweMessage({
    domain: options.domain,
    uri: options.uri,
    address: getAddress(options.address),
    chainId: options.chainId,
    nonce: options.nonce,
    version: '1',
    statement: options.statement,
    issuedAt: options.issuedAt ?? new Date(),
    expirationTime: options.expirationTime,
  });
}
