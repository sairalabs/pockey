import { base64, hex } from '@scure/base';
import {
  EVM_CHAINS,
  type ChainFamily,
  type SignMessageInput,
  type SolanaCluster,
} from '@pocketkey/types';

export function truncateMiddle(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** `0x4bF0...F711` for EVM, `7xKX...gAsU` for Solana. */
export function formatAddress(address: string, family: ChainFamily): string {
  return family === 'evm' ? truncateMiddle(address, 6, 4) : truncateMiddle(address, 4, 4);
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Integer amount in the smallest unit to a full precision decimal string. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

/** Shortens a decimal string to `maxDecimals` without rounding up. */
export function shortenDecimal(full: string, maxDecimals = 6): string {
  const [whole, fraction = ''] = full.split('.');
  if (fraction.length <= maxDecimals) return full;
  const cut = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  if (!cut) return `<${whole ?? '0'}.${'0'.repeat(maxDecimals - 1)}1`;
  return `${whole ?? '0'}.${cut}`;
}

export function evmNativeSymbol(chainId: number): string {
  return chainId === 137 ? 'POL' : 'ETH';
}

export function evmNetworkName(chainId: number): string {
  const chain = (EVM_CHAINS as Record<number, { name: string } | undefined>)[chainId];
  return chain?.name ?? `Chain ${String(chainId)}`;
}

export function solanaNetworkName(cluster: SolanaCluster): string {
  return cluster === 'mainnet-beta' ? 'Solana' : 'Solana Devnet';
}

export function hexByteLength(data: string): number {
  const digits = data.startsWith('0x') ? data.length - 2 : data.length;
  return Math.ceil(digits / 2);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Decoded text when the bytes are valid, printable UTF-8. */
export function decodePrintable(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return null;
  }
  // Control characters other than tab, line feed and carriage return are not printable.
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const whitespace = code === 9 || code === 10 || code === 13;
    if ((code < 32 && !whitespace) || code === 127) return null;
  }
  return text;
}

export interface MessageView {
  /** Plain text to show, null when the payload is binary. */
  text: string | null;
  /** `0x` hex of the bytes, null when the message was given as text. */
  hex: string | null;
}

export function messageView(input: SignMessageInput): MessageView {
  if (input.chain === 'evm') {
    if (typeof input.message === 'string') return { text: input.message, hex: null };
    const raw = input.message.raw;
    let bytes: Uint8Array;
    try {
      bytes = hex.decode(raw.slice(2).toLowerCase());
    } catch {
      return { text: null, hex: raw };
    }
    return { text: decodePrintable(bytes), hex: raw };
  }
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(input.message);
  } catch {
    return { text: null, hex: null };
  }
  return { text: decodePrintable(bytes), hex: `0x${hex.encode(bytes)}` };
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
