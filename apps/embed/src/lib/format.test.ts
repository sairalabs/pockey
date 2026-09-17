import { SigningPolicy } from '@pocketkey/types';
import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatDuration,
  formatPolicyAmount,
  policyNetworks,
  policySymbol,
} from './format';

const evm = (extra: Record<string, unknown> = {}) =>
  SigningPolicy.parse({ chain: 'evm', expiresIn: '1d', ...extra });
const solana = SigningPolicy.parse({ chain: 'solana', expiresIn: '1d' });

describe('formatDuration', () => {
  it('uses the unit it was given', () => {
    expect(formatDuration('7d')).toBe('7 days');
    expect(formatDuration('2h')).toBe('2 hours');
    expect(formatDuration('15m')).toBe('15 minutes');
  });

  it('singularizes one', () => {
    expect(formatDuration('1d')).toBe('1 day');
    expect(formatDuration('1h')).toBe('1 hour');
    expect(formatDuration('1m')).toBe('1 minute');
  });

  it('promotes to the largest unit that divides evenly', () => {
    expect(formatDuration('120m')).toBe('2 hours');
    expect(formatDuration('48h')).toBe('2 days');
    expect(formatDuration('1440m')).toBe('1 day');
    expect(formatDuration('90m')).toBe('90 minutes');
    expect(formatDuration('36h')).toBe('36 hours');
  });

  it('throws on a malformed duration', () => {
    expect(() => formatDuration('7w')).toThrow();
  });
});

describe('formatDateTime', () => {
  it('formats local date and time', () => {
    expect(
      formatDateTime(Date.parse('2026-09-24T10:00:00.000Z'), {
        locale: 'en-US',
        timeZone: 'UTC',
      }),
    ).toBe('Sep 24, 2026, 10:00 AM');
  });
});

describe('policy amounts', () => {
  it('formats wei in ETH with trailing zeros trimmed and full precision kept', () => {
    expect(formatPolicyAmount('50000000000000000', evm())).toEqual({
      short: '0.05 ETH',
      full: '0.05 ETH',
    });
    expect(formatPolicyAmount('1000000000000000000', evm())).toEqual({
      short: '1 ETH',
      full: '1 ETH',
    });
    expect(formatPolicyAmount('1234567891234567891', evm())).toEqual({
      short: '1.234567 ETH',
      full: '1.234567891234567891 ETH',
    });
    expect(formatPolicyAmount('1', evm())).toEqual({
      short: '<0.000001 ETH',
      full: '0.000000000000000001 ETH',
    });
  });

  it('formats lamports in SOL', () => {
    expect(formatPolicyAmount('100000000', solana)).toEqual({
      short: '0.1 SOL',
      full: '0.1 SOL',
    });
    expect(formatPolicyAmount('2500000000', solana).short).toBe('2.5 SOL');
  });

  it('counts Polygon in POL', () => {
    expect(policySymbol(evm({ allowedChains: [137] }))).toBe('POL');
    expect(formatPolicyAmount('2000000000000000000', evm({ allowedChains: [137] })).short).toBe(
      '2 POL',
    );
    expect(policySymbol(evm({ allowedChains: [8453, 137] }))).toBe('ETH or POL');
    expect(policySymbol(evm({ allowedChains: [8453] }))).toBe('ETH');
    expect(policySymbol(evm())).toBe('ETH');
    expect(policySymbol(solana)).toBe('SOL');
  });
});

describe('policyNetworks', () => {
  it('names the allowed EVM chains, or Solana', () => {
    expect(policyNetworks(evm({ allowedChains: [8453, 42161] }))).toBe('Base, Arbitrum One');
    expect(policyNetworks(solana)).toBe('Solana');
  });

  it('is null when any EVM chain is allowed', () => {
    expect(policyNetworks(evm())).toBeNull();
    expect(policyNetworks(evm({ allowedChains: [] }))).toBeNull();
  });
});
