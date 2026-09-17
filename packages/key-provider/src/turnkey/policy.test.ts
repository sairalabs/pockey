import type { SigningPolicy } from '@pocketkey/types';
import { describe, expect, it } from 'vitest';
import { quote, toTurnkeyPolicy } from './policy.js';

const target = { walletId: 'wlt-1', sessionUserId: 'user-1', policyName: 'pocketkey:ses_1' };
const RAW =
  "activity.type in ['ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOADS']";
const TX = "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2'";

describe('toTurnkeyPolicy', () => {
  it('maps an EVM policy', () => {
    const policy = {
      chain: 'evm',
      expiresIn: '1d',
      maxValuePerTx: '1000',
      maxValueTotal: '5000',
      allowedChains: [8453, 84532],
      allowedContracts: ['0x4200000000000000000000000000000000000006'],
      allowMessages: true,
    } as SigningPolicy;
    expect(toTurnkeyPolicy(policy, target)).toEqual({
      policyName: 'pocketkey:ses_1',
      effect: 'EFFECT_ALLOW',
      consensus: "approvers.any(user, user.id == 'user-1')",
      condition:
        `wallet.id == 'wlt-1' && ((${TX} && eth.tx.chain_id in [8453, 84532] && ` +
        `eth.tx.to in ['0x4200000000000000000000000000000000000006'] && eth.tx.value <= 1000) || ${RAW})`,
      notes:
        'Pocketkey session signer (evm, 1d). Enforced by Pocketkey only: expiry, maxValueTotal.',
    });
  });

  it('maps a Solana policy and always allows the compute budget program', () => {
    const policy = {
      chain: 'solana',
      expiresIn: '2h',
      maxValuePerTx: '5000',
      allowedPrograms: ['11111111111111111111111111111111'],
    } as SigningPolicy;
    expect(toTurnkeyPolicy(policy, { ...target, allowRawPayloads: false })).toEqual({
      policyName: 'pocketkey:ses_1',
      effect: 'EFFECT_ALLOW',
      consensus: "approvers.any(user, user.id == 'user-1')",
      condition:
        `wallet.id == 'wlt-1' && ((${TX} && solana.tx.program_keys.all(p, p in ` +
        `['11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111']) && ` +
        `solana.tx.transfers.all(t, t.amount <= 5000)))`,
      notes: 'Pocketkey session signer (solana, 2h). Enforced by Pocketkey only: expiry.',
    });
  });

  it('maps an empty policy to wallet scoped transactions only', () => {
    const policy = { chain: 'evm', expiresIn: '15m' } as SigningPolicy;
    expect(toTurnkeyPolicy(policy, target).condition).toBe(`wallet.id == 'wlt-1' && (${TX})`);
  });

  it('only allows raw payloads when the session allows messages', () => {
    const policy = { chain: 'evm', expiresIn: '15m', allowMessages: true } as SigningPolicy;
    expect(toTurnkeyPolicy(policy, target).condition).toBe(
      `wallet.id == 'wlt-1' && (${TX} || ${RAW})`,
    );
  });

  it('escapes quotes and backslashes in ids', () => {
    expect(quote("a'b\\c")).toBe("'a\\'b\\\\c'");
    const policy = { chain: 'evm', expiresIn: '15m' } as SigningPolicy;
    const out = toTurnkeyPolicy(policy, { ...target, walletId: "x' || true || '" });
    expect(out.condition.startsWith("wallet.id == 'x\\' || true || \\'' && (")).toBe(true);
  });
});
