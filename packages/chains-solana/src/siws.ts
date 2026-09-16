import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';

const HEADER_SUFFIX = ' wants you to sign in with your Solana account:';
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Builds a Sign In With Solana message (Solana Wallet Standard text layout,
 * mirroring EIP-4361). `issuedAt` defaults to now.
 */
export function buildSiwsMessage(options: {
  domain: string;
  address: string;
  nonce: string;
  statement?: string;
  uri?: string;
  issuedAt?: Date;
  expirationTime?: Date;
  chainId?: 'mainnet' | 'devnet';
}): string {
  if (/\s/.test(options.domain)) throw new Error('SIWS domain must not contain whitespace');
  if (!/^[A-Za-z0-9]+$/.test(options.nonce)) throw new Error('SIWS nonce must be alphanumeric');
  if (options.statement?.includes('\n')) throw new Error('SIWS statement must be a single line');

  let message = `${options.domain}${HEADER_SUFFIX}\n${options.address}`;
  if (options.statement !== undefined) message += `\n\n${options.statement}`;

  const fields: string[] = [];
  if (options.uri !== undefined) fields.push(`URI: ${options.uri}`);
  fields.push('Version: 1');
  if (options.chainId !== undefined) fields.push(`Chain ID: ${options.chainId}`);
  fields.push(`Nonce: ${options.nonce}`);
  fields.push(`Issued At: ${(options.issuedAt ?? new Date()).toISOString()}`);
  if (options.expirationTime !== undefined) {
    fields.push(`Expiration Time: ${options.expirationTime.toISOString()}`);
  }
  message += `\n\n${fields.join('\n')}`;
  return message;
}

const KNOWN_FIELDS = new Set([
  'URI',
  'Version',
  'Chain ID',
  'Nonce',
  'Issued At',
  'Expiration Time',
  'Not Before',
  'Request ID',
]);

interface ParsedSiws {
  domain: string;
  address: string;
  fields: Map<string, string>;
}

function parseSiws(message: string): ParsedSiws | null {
  const blocks = message.split('\n\n');
  if (blocks.length !== 2 && blocks.length !== 3) return null;

  const header = (blocks[0] ?? '').split('\n');
  const [first, address] = header;
  if (header.length !== 2 || first === undefined || address === undefined) return null;
  if (!first.endsWith(HEADER_SUFFIX)) return null;
  const domain = first.slice(0, -HEADER_SUFFIX.length);
  if (domain.length === 0 || /\s/.test(domain)) return null;

  const fields = new Map<string, string>();
  const lines = (blocks[blocks.length - 1] ?? '').split('\n');
  let inResources = false;
  for (const line of lines) {
    if (inResources) {
      if (!line.startsWith('- ')) return null;
      continue;
    }
    if (line === 'Resources:') {
      inResources = true;
      continue;
    }
    const separator = line.indexOf(': ');
    if (separator <= 0) return null;
    const key = line.slice(0, separator);
    if (!KNOWN_FIELDS.has(key) || fields.has(key)) return null;
    fields.set(key, line.slice(separator + 2));
  }
  return { domain, address, fields };
}

function parseDate(value: string | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (!RFC3339.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Verifies a Sign In With Solana login offline: message fields, then the ed25519
 * signature over the UTF-8 message. Returns null on any mismatch and never throws.
 */
export function verifySiwsLogin(options: {
  message: string;
  /** Base64 encoded 64-byte signature. */
  signature: string;
  /** Base58 public key. */
  publicKey: string;
  expectedNonce: string;
  expectedDomain?: string;
  now?: Date;
}): { address: string } | null {
  try {
    const {
      message,
      signature,
      publicKey,
      expectedNonce,
      expectedDomain,
      now = new Date(),
    } = options;
    if (expectedNonce.length === 0 || Number.isNaN(now.getTime())) return null;

    const parsed = parseSiws(message);
    if (!parsed) return null;
    if (parsed.address !== publicKey) return null;
    if (expectedDomain !== undefined && parsed.domain !== expectedDomain) return null;
    if (parsed.fields.get('Nonce') !== expectedNonce) return null;

    const version = parsed.fields.get('Version');
    if (version !== undefined && version !== '1') return null;

    const issuedAt = parseDate(parsed.fields.get('Issued At'));
    const expirationTime = parseDate(parsed.fields.get('Expiration Time'));
    const notBefore = parseDate(parsed.fields.get('Not Before'));
    if (issuedAt === null || expirationTime === null || notBefore === null) return null;
    if (expirationTime && now.getTime() >= expirationTime.getTime()) return null;
    if (notBefore && now.getTime() < notBefore.getTime()) return null;

    const publicKeyBytes = base58.decode(publicKey);
    const signatureBytes = base64.decode(signature);
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return null;

    const valid = ed25519.verify(signatureBytes, new TextEncoder().encode(message), publicKeyBytes);
    return valid ? { address: publicKey } : null;
  } catch {
    return null;
  }
}
