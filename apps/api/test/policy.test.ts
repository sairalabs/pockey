import type { InspectedTransaction } from '@pocketkey/chains-solana';
import {
  SessionSignRequest,
  type PolicyViolation,
  type SessionSignRequestInput,
  type SigningPolicy,
} from '@pocketkey/types';
import { describe, expect, it } from 'vitest';
import {
  checkSessionRequest,
  checkSessionState,
  type PolicyContext,
  type SessionState,
} from '../src/services/policy.js';

const NOW = new Date('2026-09-17T12:00:00Z');
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const SOL_ADDRESS = 'So1anaWa11et1111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const OTHER_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function session(
  policy: Partial<SigningPolicy> & { chain: 'evm' | 'solana' },
  extra: Partial<SessionState> = {},
): SessionState {
  return {
    walletId: policy.chain === 'evm' ? 'wlt_evm' : 'wlt_sol',
    policy: { expiresIn: '1h', ...policy },
    spentTotal: '0',
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    revokedAt: null,
    ...extra,
  };
}

const enabledChains = { evm: [8453, 84532] as const, solana: ['devnet'] as const };

function evmContext(tx: Partial<NonNullable<PolicyContext['evmTransaction']>> = {}): PolicyContext {
  return {
    now: NOW,
    wallet: { id: 'wlt_evm', chainFamily: 'evm', address: EVM_ADDRESS },
    enabledChains: { evm: [...enabledChains.evm], solana: [...enabledChains.solana] },
    evmTransaction: { chainId: 8453, to: WETH, value: 0n, ...tx },
  };
}

function transferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

/** Keys: wallet, a stranger, a recipient, then programs. */
function solanaTx(
  instructions: { programId: string; from?: number; lamports?: bigint; data?: Uint8Array }[],
): InspectedTransaction {
  const programs = [...new Set(instructions.map((ix) => ix.programId))];
  const staticAccountKeys = [
    SOL_ADDRESS,
    'Stranger11111111111111111111111111111111111',
    'Recipient1111111111111111111111111111111111',
    ...programs,
  ];
  return {
    version: 'legacy',
    staticAccountKeys,
    numRequiredSignatures: 1,
    numReadonlySigned: 0,
    numReadonlyUnsigned: programs.length,
    recentBlockhash: SYSTEM,
    instructions: instructions.map((ix) => ({
      programId: ix.programId,
      programIdIndex: 3 + programs.indexOf(ix.programId),
      accountIndexes: [ix.from ?? 0, 2],
      data:
        ix.data ?? (ix.lamports !== undefined ? transferData(ix.lamports) : new Uint8Array([1])),
    })),
    addressTableLookups: [],
    signed: [false],
  };
}

function solContext(tx?: InspectedTransaction): PolicyContext {
  return {
    now: NOW,
    wallet: { id: 'wlt_sol', chainFamily: 'solana', address: SOL_ADDRESS },
    enabledChains: { evm: [...enabledChains.evm], solana: [...enabledChains.solana] },
    ...(tx ? { solanaTransaction: tx } : {}),
  };
}

const req = (input: SessionSignRequestInput) => SessionSignRequest.parse(input);

const evmTx = (overrides: Record<string, unknown> = {}) =>
  req({
    kind: 'transaction',
    input: { chain: 'evm', chainId: 8453, to: WETH, ...overrides } as never,
  });

const solTx = (cluster: 'devnet' | 'mainnet-beta' = 'devnet') =>
  req({ kind: 'transaction', input: { chain: 'solana', cluster, transaction: 'AA==' } });

const message = req({ kind: 'message', input: { chain: 'evm', message: 'gm' } });

function typedData(verifyingContract?: string) {
  return req({
    kind: 'typedData',
    input: {
      chain: 'evm',
      domain: verifyingContract ? { verifyingContract } : {},
      types: {},
      primaryType: 'X',
      message: {},
    } as never,
  });
}

function reason(check: ReturnType<typeof checkSessionRequest>): PolicyViolation | 'ok' {
  return check.ok ? 'ok' : check.reason;
}

describe('checkSessionState', () => {
  it('refuses revoked before expired, and expires at expiresAt exactly', () => {
    const revokedAndExpired = session({ chain: 'evm' }, { revokedAt: NOW, expiresAt: NOW });
    expect(reason(checkSessionState(revokedAndExpired, NOW))).toBe('session_revoked');
    expect(reason(checkSessionState(session({ chain: 'evm' }, { expiresAt: NOW }), NOW))).toBe(
      'session_expired',
    );
    const justBefore = new Date(NOW.getTime() - 1);
    expect(
      reason(checkSessionState(session({ chain: 'evm' }, { expiresAt: NOW }), justBefore)),
    ).toBe('ok');
  });
});

describe('checkSessionRequest: session and wallet', () => {
  it('applies revocation and expiry to every request kind', () => {
    const revoked = session({ chain: 'evm' }, { revokedAt: NOW });
    expect(reason(checkSessionRequest(revoked, message, evmContext()))).toBe('session_revoked');
    const expired = session({ chain: 'evm' }, { expiresAt: new Date(NOW.getTime() - 1) });
    expect(reason(checkSessionRequest(expired, evmTx(), evmContext()))).toBe('session_expired');
  });

  it('refuses another wallet, another chain family, and missing transaction data', () => {
    const evmSession = session({ chain: 'evm' });
    expect(
      reason(checkSessionRequest({ ...evmSession, walletId: 'wlt_other' }, message, evmContext())),
    ).toBe('wallet_mismatch');
    expect(reason(checkSessionRequest(evmSession, message, solContext()))).toBe('wallet_mismatch');
    const solMessage = req({ kind: 'message', input: { chain: 'solana', message: 'AA==' } });
    expect(reason(checkSessionRequest(evmSession, solMessage, evmContext()))).toBe(
      'wallet_mismatch',
    );
    expect(reason(checkSessionRequest(evmSession, solTx(), evmContext()))).toBe('wallet_mismatch');
    const { evmTransaction: _drop, ...noTx } = evmContext();
    expect(reason(checkSessionRequest(evmSession, evmTx(), noTx))).toBe('wallet_mismatch');
    expect(reason(checkSessionRequest(evmSession, evmTx({ chainId: 84532 }), evmContext()))).toBe(
      'wallet_mismatch',
    );
    expect(reason(checkSessionRequest(session({ chain: 'solana' }), solTx(), solContext()))).toBe(
      'wallet_mismatch',
    );
    expect(
      reason(checkSessionRequest(session({ chain: 'solana' }), typedData(WETH), solContext())),
    ).toBe('wallet_mismatch');
  });

  it('refuses messages unless the session allows them', () => {
    expect(reason(checkSessionRequest(session({ chain: 'evm' }), message, evmContext()))).toBe(
      'messages_not_allowed',
    );
  });

  it('allows messages with a zero value when the session allows them', () => {
    expect(
      checkSessionRequest(
        session({ chain: 'evm', maxValueTotal: '0', allowMessages: true }),
        message,
        evmContext(),
      ),
    ).toEqual({
      ok: true,
      value: 0n,
    });
  });
});

describe('checkSessionRequest: typed data', () => {
  it('needs a contract allowlist containing the verifying contract', () => {
    expect(
      reason(
        checkSessionRequest(
          session({ chain: 'evm', allowMessages: true }),
          typedData(WETH),
          evmContext(),
        ),
      ),
    ).toBe('typed_data_not_allowed');
    expect(
      reason(
        checkSessionRequest(
          session({ chain: 'evm', allowedContracts: [USDC.toLowerCase() as never] }),
          typedData(USDC),
          evmContext(),
        ),
      ),
    ).toBe('messages_not_allowed');
    const allowlisted = session({
      chain: 'evm',
      allowedContracts: [USDC.toLowerCase() as never],
      allowMessages: true,
    });
    expect(reason(checkSessionRequest(allowlisted, typedData(), evmContext()))).toBe(
      'typed_data_not_allowed',
    );
    expect(reason(checkSessionRequest(allowlisted, typedData(WETH), evmContext()))).toBe(
      'typed_data_not_allowed',
    );
    expect(reason(checkSessionRequest(allowlisted, typedData(USDC), evmContext()))).toBe('ok');
  });
});

describe('checkSessionRequest: EVM transactions', () => {
  it('refuses chains the app did not enable or the policy does not allow', () => {
    expect(
      reason(
        checkSessionRequest(
          session({ chain: 'evm' }),
          evmTx({ chainId: 1 }),
          evmContext({ chainId: 1 }),
        ),
      ),
    ).toBe('chain_not_allowed');
    const baseSepoliaOnly = session({ chain: 'evm', allowedChains: [84532] });
    expect(reason(checkSessionRequest(baseSepoliaOnly, evmTx(), evmContext()))).toBe(
      'chain_not_allowed',
    );
    expect(
      reason(
        checkSessionRequest(
          baseSepoliaOnly,
          evmTx({ chainId: 84532 }),
          evmContext({ chainId: 84532 }),
        ),
      ),
    ).toBe('ok');
  });

  it('refuses destinations outside the allowlist, case-insensitively, and contract creation', () => {
    const allowlisted = session({ chain: 'evm', allowedContracts: [USDC.toLowerCase() as never] });
    expect(reason(checkSessionRequest(allowlisted, evmTx(), evmContext()))).toBe(
      'contract_not_allowed',
    );
    expect(
      reason(checkSessionRequest(allowlisted, evmTx({ to: USDC }), evmContext({ to: USDC }))),
    ).toBe('ok');
    expect(reason(checkSessionRequest(allowlisted, evmTx(), evmContext({ to: null })))).toBe(
      'contract_not_allowed',
    );
    expect(
      reason(checkSessionRequest(session({ chain: 'evm' }), evmTx(), evmContext({ to: null }))),
    ).toBe('ok');
  });

  it('enforces maxValuePerTx and maxValueTotal with the running total', () => {
    const capped = session({ chain: 'evm', maxValuePerTx: '100', maxValueTotal: '250' });
    expect(checkSessionRequest(capped, evmTx(), evmContext({ value: 100n }))).toEqual({
      ok: true,
      value: 100n,
    });
    expect(reason(checkSessionRequest(capped, evmTx(), evmContext({ value: 101n })))).toBe(
      'value_per_tx_exceeded',
    );
    const spent = { ...capped, spentTotal: '200' };
    expect(reason(checkSessionRequest(spent, evmTx(), evmContext({ value: 50n })))).toBe('ok');
    expect(reason(checkSessionRequest(spent, evmTx(), evmContext({ value: 51n })))).toBe(
      'value_total_exceeded',
    );
  });
});

describe('checkSessionRequest: Solana transactions', () => {
  const sol = (policy: Partial<SigningPolicy> = {}, extra: Partial<SessionState> = {}) =>
    session({ chain: 'solana', ...policy }, extra);

  it('refuses clusters the app did not enable', () => {
    const tx = solanaTx([{ programId: SYSTEM, lamports: 1n }]);
    expect(reason(checkSessionRequest(sol(), solTx('mainnet-beta'), solContext(tx)))).toBe(
      'chain_not_allowed',
    );
    expect(reason(checkSessionRequest(sol(), solTx(), solContext(tx)))).toBe('ok');
  });

  it('requires every program in the allowlist, ComputeBudget excepted', () => {
    const policy = sol({ allowedPrograms: [SYSTEM as never] });
    const ok = solanaTx([{ programId: COMPUTE }, { programId: SYSTEM, lamports: 1n }]);
    expect(reason(checkSessionRequest(policy, solTx(), solContext(ok)))).toBe('ok');
    const other = solanaTx([{ programId: SYSTEM, lamports: 1n }, { programId: OTHER_PROGRAM }]);
    expect(reason(checkSessionRequest(policy, solTx(), solContext(other)))).toBe(
      'program_not_allowed',
    );
  });

  it('counts System transfers from the wallet only against value limits', () => {
    const capped = sol({ maxValuePerTx: '1000', maxValueTotal: '1500' });
    const tx = solanaTx([
      { programId: SYSTEM, lamports: 600n },
      { programId: SYSTEM, lamports: 400n },
      { programId: SYSTEM, lamports: 9_999n, from: 1 },
    ]);
    expect(checkSessionRequest(capped, solTx(), solContext(tx))).toEqual({
      ok: true,
      value: 1000n,
    });
    const tooMuch = solanaTx([{ programId: SYSTEM, lamports: 1001n }]);
    expect(reason(checkSessionRequest(capped, solTx(), solContext(tooMuch)))).toBe(
      'value_per_tx_exceeded',
    );
    expect(
      reason(checkSessionRequest({ ...capped, spentTotal: '501' }, solTx(), solContext(tx))),
    ).toBe('value_total_exceeded');
  });
});
