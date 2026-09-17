import { describe, expect, it } from 'vitest';
import {
  AllowedOrigin,
  AppConfig,
  AppId,
  Duration,
  durationToSeconds,
  HostRequest,
  PublicAppId,
  SecretApiKey,
  SendTransactionInput,
  SigningPolicy,
} from './index.js';

const cuid = 'tz4a98xxat96iws9zmbrgj3a';

describe('ids', () => {
  it('accepts a correctly prefixed cuid2', () => {
    expect(AppId.safeParse(`app_${cuid}`).success).toBe(true);
    expect(PublicAppId.safeParse(`pk_app_${cuid}`).success).toBe(true);
    expect(SecretApiKey.safeParse(`pk_sk_${cuid}`).success).toBe(true);
  });

  it('rejects wrong prefixes and malformed bodies', () => {
    expect(AppId.safeParse(`usr_${cuid}`).success).toBe(false);
    expect(AppId.safeParse('app_short').success).toBe(false);
    expect(PublicAppId.safeParse(`app_${cuid}`).success).toBe(false);
  });
});

describe('AppConfig', () => {
  it('fills defaults from an empty object', () => {
    const config = AppConfig.parse({});
    expect(config.loginMethods).toEqual(['email', 'google', 'passkey']);
    expect(config.chains.evm).toEqual([8453]);
    expect(config.appearance.accent).toBe('#d2042d');
    expect(config.embeddedWallets.createOnLogin).toBe('all');
    expect(config.gasSponsoring.evm).toBe(false);
  });

  it('rejects an unknown login method and an unsupported chain', () => {
    expect(AppConfig.safeParse({ loginMethods: ['sms'] }).success).toBe(false);
    expect(AppConfig.safeParse({ chains: { evm: [999] } }).success).toBe(false);
  });
});

describe('AllowedOrigin', () => {
  it('normalizes to origin and refuses paths', () => {
    expect(AllowedOrigin.parse('https://app.example.com/')).toBe('https://app.example.com');
    expect(AllowedOrigin.safeParse('https://app.example.com/login').success).toBe(false);
    expect(AllowedOrigin.safeParse('*').success).toBe(false);
  });
});

describe('Duration', () => {
  it('converts and caps at 30 days', () => {
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('2h')).toBe(7200);
    expect(durationToSeconds('7d')).toBe(604800);
    expect(Duration.safeParse('31d').success).toBe(false);
    expect(Duration.safeParse('1w').success).toBe(false);
  });
});

describe('SigningPolicy', () => {
  it('accepts an EVM policy with contract allowlist', () => {
    const result = SigningPolicy.safeParse({
      chain: 'evm',
      expiresIn: '7d',
      maxValuePerTx: '10000000000000000',
      allowedContracts: ['0x4200000000000000000000000000000000000006'],
    });
    expect(result.success).toBe(true);
  });
});

describe('SendTransactionInput', () => {
  it('defaults value, data and sponsored on EVM', () => {
    const tx = SendTransactionInput.parse({
      chain: 'evm',
      chainId: 8453,
      to: '0x4200000000000000000000000000000000000006',
    });
    expect(tx.sponsored).toBe(false);
    if (tx.chain === 'evm') {
      expect(tx.value).toBe('0');
      expect(tx.data).toBe('0x');
    }
  });
});

describe('embed protocol', () => {
  it('parses a tagged request and rejects the wrong version or tag', () => {
    const ok = HostRequest.safeParse({
      source: 'pocketkey',
      pk: 1,
      requestId: 'r1',
      type: 'signMessage',
      walletId: 'wlt_x',
      input: { chain: 'evm', message: 'gm' },
    });
    expect(ok.success).toBe(true);
    expect(
      HostRequest.safeParse({ source: 'pocketkey', pk: 2, requestId: 'r1', type: 'logout' })
        .success,
    ).toBe(false);
    expect(
      HostRequest.safeParse({ source: 'other', pk: 1, requestId: 'r1', type: 'logout' }).success,
    ).toBe(false);
  });
});

describe('SigningPolicy message sessions', () => {
  it('caps sessions that allow messages at 24 hours', () => {
    const base = { chain: 'evm', expiresIn: '7d' } as const;
    expect(SigningPolicy.safeParse(base).success).toBe(true);
    expect(SigningPolicy.safeParse({ ...base, allowMessages: true }).success).toBe(false);
    expect(
      SigningPolicy.safeParse({ chain: 'evm', expiresIn: '24h', allowMessages: true }).success,
    ).toBe(true);
    expect(
      SigningPolicy.safeParse({ chain: 'evm', expiresIn: '25h', allowMessages: true }).success,
    ).toBe(false);
  });
});
