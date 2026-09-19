import { ed25519 } from '@noble/curves/ed25519.js';
import type { EvmRpc } from '@pocketkey/chains-evm';
import { SYSTEM_PROGRAM_ID, type SolanaRpc } from '@pocketkey/chains-solana';
import {
  appSystemWallets,
  paymentEvents,
  sessionSigners,
  sponsorBalances,
  sponsorLedger,
  usageEvents,
  wallets,
} from '@pocketkey/db';
import {
  chargedCents,
  createStaticPriceFeed,
  type EvmSponsorClientsFactory,
} from '@pocketkey/gas-sponsor';
import { createMockPayments, MOCK_WEBHOOK_SECRET } from '@pocketkey/payments';
import {
  ApiErrorBody,
  SendTransactionOutput,
  SessionSignOutput,
  SmartAccountOutput,
  SolanaFeePayerOutput,
  SponsorBalance,
  TopUpCheckoutOutput,
  type AuthResponse,
  type SessionSignRequestInput,
  type SigningPolicy,
  type Wallet,
} from '@pocketkey/types';
import { base58, base64 } from '@scure/base';
import { and, eq, sql } from 'drizzle-orm';
import { hashMessage, keccak256, recoverAddress, stringToHex, type Hex } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setRpcFactory } from '../src/lib/rpc.js';
import {
  setEvmSponsorFactoryForTests,
  setPriceFeedForTests,
  STATIC_PRICES,
} from '../src/lib/sponsor.js';
import type { Device } from './device.js';
import {
  app,
  bearer,
  db,
  EMBED_ORIGIN,
  env,
  loginWithEmail,
  SEED,
  seedDb,
  updateSeedConfig,
  withApp,
} from './helpers.js';

const WETH = '0x4200000000000000000000000000000000000006';
const SMART_ACCOUNT = '0x2222222222222222222222222222222222222222';
const USER_OP_HASH: Hex = `0x${'ab'.repeat(32)}`;
const TX_HASH: Hex = `0x${'cd'.repeat(32)}`;

/* Fake EVM bundler: fixed prepared cost, lower actual cost in the receipt. */
const GAS = {
  callGasLimit: 100_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 50_000n,
  paymasterVerificationGasLimit: 30_000n,
  paymasterPostOpGasLimit: 20_000n,
  maxFeePerGas: 2_000_000_000n,
};
const MAX_COST_WEI = 400_000n * 2_000_000_000n;
const ACTUAL_COST_WEI = 200_000_000_000_000n;

const sends: { balanceAtSend: number; signature: Hex; digest: Hex }[] = [];
let failNextUserOp = false;

/* Every prepared operation gets its own nonce, hence its own digest. */
let nonce = 0;
const digests = new Map<string, Hex>();

const fakeBundler: EvmSponsorClientsFactory = {
  getSmartAccountAddress: async () => SMART_ACCOUNT,
  prepareUserOperation: async ({ calls }) => {
    const opNonce = String(nonce++);
    const userOpHash = keccak256(stringToHex(`${opNonce}:${calls[0]?.value ?? 0n}`));
    const digest = hashMessage({ raw: userOpHash });
    digests.set(opNonce, digest);
    return {
      sender: SMART_ACCOUNT,
      ...GAS,
      userOperation: { sender: SMART_ACCOUNT, nonce: opNonce, callData: '0x' },
      userOpHash,
      digest,
    };
  },
  sendUserOperation: async ({ userOperation, signature }) => {
    if (failNextUserOp) {
      failNextUserOp = false;
      throw new Error(
        'AA21 did not pay prefund https://api.pimlico.io/v2/8453/rpc?apikey=pim_secret',
      );
    }
    const digest = digests.get(userOperation.nonce ?? '') ?? '0x';
    sends.push({ balanceAtSend: await balanceCents(), signature, digest });
    return USER_OP_HASH;
  },
  waitForUserOperationReceipt: async () => ({
    transactionHash: TX_HASH,
    actualGasCost: ACTUAL_COST_WEI,
    success: true,
  }),
};

/* Fake RPCs */
const sentSolana: Uint8Array[] = [];
let failNextSolana = false;
const fakeSolana: SolanaRpc = {
  getLatestBlockhash: async () => ({
    blockhash: base58.encode(new Uint8Array(32)),
    lastValidBlockHeight: 1,
  }),
  sendRawTransaction: async (bytes) => {
    if (failNextSolana) {
      failNextSolana = false;
      throw new Error('Blockhash not found');
    }
    sentSolana.push(bytes);
    return 'ignored';
  },
};
const fakeEvm: EvmRpc = {
  getTransactionCount: async () => 0,
  estimateGas: async () => 21_000n,
  estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
  sendRawTransaction: async () => '0x01',
};

/* Requests with an execution context, so `waitUntil` work can be awaited. */
const background: Promise<unknown>[] = [];
const executionCtx = {
  waitUntil: (promise: Promise<unknown>) => {
    background.push(promise);
  },
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

const call = (path: string, init: RequestInit = {}) => app.request(path, init, env, executionCtx);

async function drainBackground(): Promise<void> {
  while (background.length > 0) await Promise.all(background.splice(0));
}

let login: AuthResponse;
let device: Device;
let evm: Wallet;
let solana: Wallet;

const postUser = (path: string, body: unknown, token = login.accessToken) =>
  call(path, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const getUser = (path: string, token = login.accessToken) => call(path, { headers: bearer(token) });

const secretHeaders = {
  'X-Pocketkey-App-Id': SEED.app.publicId,
  Authorization: `Bearer ${SEED.apiKey.secret}`,
  'Content-Type': 'application/json',
};

async function expectError(res: Response, status: number, code: string): Promise<unknown> {
  expect(res.status, await res.clone().text()).toBe(status);
  const { error } = ApiErrorBody.parse(await res.json());
  expect(error.code).toBe(code);
  return error.details;
}

async function balanceCents(): Promise<number> {
  const row = await db().query.sponsorBalances.findFirst({
    where: eq(sponsorBalances.appId, SEED.app.id),
  });
  return row?.balanceCents ?? 0;
}

async function setBalance(cents: number): Promise<void> {
  await db()
    .insert(sponsorBalances)
    .values({ appId: SEED.app.id, balanceCents: cents })
    .onConflictDoUpdate({ target: sponsorBalances.appId, set: { balanceCents: cents } });
}

async function ledger() {
  return db()
    .select()
    .from(sponsorLedger)
    .where(eq(sponsorLedger.appId, SEED.app.id))
    .orderBy(sql`rowid`);
}

/** Ledger rows written by `run`. */
async function newLedgerRows(run: () => Promise<void>) {
  const before = (await ledger()).length;
  await run();
  return (await ledger()).slice(before);
}

const SPONSORING_ON = { evm: true, solana: true, solanaDailyCapLamports: '0' };

async function feePayer(): Promise<string> {
  const res = await call('/v1/sponsor/solana/fee-payer?cluster=devnet', { headers: withApp() });
  expect(res.status, await res.clone().text()).toBe(200);
  return SolanaFeePayerOutput.parse(await res.json()).feePayer;
}

/**
 * Legacy transaction: fee payer and user sign, one System transfer from the user.
 * `feePayerAsAccount` makes the transfer spend from the fee payer instead (misuse).
 */
function sponsoredTransfer(
  payer: string,
  user: string,
  lamports: bigint,
  options: { feePayerAsAccount?: boolean; program?: string } = {},
): string {
  const recipient = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const program = options.program ?? SYSTEM_PROGRAM_ID;
  const keys = [base58.decode(payer), base58.decode(user), recipient, base58.decode(program)];
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  const message = [
    2, // required signatures: fee payer and user
    0,
    1, // the program is readonly
    keys.length,
    ...keys.flatMap((key) => [...key]),
    ...new Uint8Array(32).fill(7),
    1,
    3,
    2,
    options.feePayerAsAccount ? 0 : 1,
    2,
    data.length,
    ...data,
  ];
  return base64.encode(Uint8Array.from([2, ...new Uint8Array(128), ...message]));
}

const SOLANA_FEE_LAMPORTS = 10_000n;
const solanaCents = () =>
  chargedCents({ amount: SOLANA_FEE_LAMPORTS, decimals: 9, usdPerUnit: STATIC_PRICES.SOL });
const evmMaxCents = () =>
  chargedCents({ amount: MAX_COST_WEI, decimals: 18, usdPerUnit: STATIC_PRICES.ETH });
const evmActualCents = () =>
  chargedCents({ amount: ACTUAL_COST_WEI, decimals: 18, usdPerUnit: STATIC_PRICES.ETH });

const evmSponsored = (overrides: Record<string, unknown> = {}) => ({
  chain: 'evm',
  chainId: 8453,
  to: WETH,
  sponsored: true,
  ...overrides,
});

/** Prepared by the API, digest signed by the iframe: body of send-transaction. */
async function sponsoredEvmBody(overrides: Record<string, unknown> = {}) {
  const out = await device.transactionBody(evm, evmSponsored(overrides));
  if (!('prepared' in out) || out.prepared.kind !== 'userOperation') {
    throw new Error('expected a user operation');
  }
  return { ...out, prepared: out.prepared };
}

const sendSponsoredEvm = async (overrides: Record<string, unknown> = {}) =>
  postUser(`/v1/wallets/${evm.id}/send-transaction`, await sponsoredEvmBody(overrides));

/** Sponsored Solana send stamped by the iframe. */
const sendSponsoredSolana = async (transaction: string) =>
  postUser(
    `/v1/wallets/${solana.id}/send-transaction`,
    await device.transactionBody(solana, {
      chain: 'solana',
      cluster: 'devnet',
      transaction,
      sponsored: true,
    }),
  );

beforeAll(async () => {
  await seedDb();
  await updateSeedConfig({ gasSponsoring: SPONSORING_ON });
  setRpcFactory({ evm: () => fakeEvm, solana: () => fakeSolana });
  setEvmSponsorFactoryForTests(fakeBundler);
  setPriceFeedForTests(createStaticPriceFeed({ ...STATIC_PRICES }));
  ({ body: login, device } = await loginWithEmail('sponsor@test.dev'));
  evm = device.wallet('evm');
  solana = device.wallet('solana');
});

afterAll(async () => {
  setRpcFactory(undefined);
  setEvmSponsorFactoryForTests(undefined);
  setPriceFeedForTests(undefined);
  await updateSeedConfig({});
});

beforeEach(async () => {
  await drainBackground();
  sends.length = 0;
  sentSolana.length = 0;
  failNextUserOp = false;
  failNextSolana = false;
});

describe('top-ups (T4.6)', () => {
  const stripe = createMockPayments();
  const webhook = (payload: string, signature: string | null) =>
    call('/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature === null ? {} : { 'Stripe-Signature': signature }),
      },
      body: payload,
    });

  it('credits a signed checkout webhook once, even when Stripe replays it', async () => {
    await setBalance(0);
    const { payload, signatureHeader } = stripe.completedEvent(SEED.app.id, 2500);
    const eventId = (JSON.parse(payload) as { id: string }).id;

    const first = await webhook(payload, signatureHeader);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    expect(first.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await balanceCents()).toBe(2500);

    const replay = await webhook(payload, signatureHeader);
    expect(replay.status).toBe(200);
    expect(await balanceCents()).toBe(2500);

    const rows = (await ledger()).filter((row) => row.reference === eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'topup', amountCents: 2500 });
    const events = await db().select().from(paymentEvents).where(eq(paymentEvents.id, eventId));
    expect(events).toHaveLength(1);
  });

  it('refuses a bad, missing or stale signature without crediting', async () => {
    await setBalance(0);
    const { payload, signatureHeader } = stripe.completedEvent(SEED.app.id, 900);
    const forged = signatureHeader.replace(/v1=[0-9a-f]+/, `v1=${'0'.repeat(64)}`);
    expect(await expectError(await webhook(payload, forged), 400, 'bad_request')).toEqual({
      reason: 'invalid_signature',
    });
    expect(await expectError(await webhook(payload, null), 400, 'bad_request')).toEqual({
      reason: 'invalid_signature',
    });

    const timestamp = Math.floor(Date.now() / 1000) - 3600;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(MOCK_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`)),
    );
    const hex = [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(
      await expectError(await webhook(payload, `t=${timestamp},v1=${hex}`), 400, 'bad_request'),
    ).toEqual({ reason: 'stale_signature' });

    expect(await balanceCents()).toBe(0);
  });

  it('acknowledges a top-up for an unknown app without crediting anything', async () => {
    await setBalance(0);
    const { payload, signatureHeader } = stripe.completedEvent('app_doesnotexist000000000000', 700);
    const res = await webhook(payload, signatureHeader);
    expect(res.status).toBe(200);
    expect(await balanceCents()).toBe(0);
  });
});

describe('server sponsoring routes', () => {
  it('returns the balance and creates a checkout with the secret key', async () => {
    await setBalance(1234);
    const balance = await call('/v1/server/sponsoring/balance', { headers: secretHeaders });
    expect(balance.status, await balance.clone().text()).toBe(200);
    expect(SponsorBalance.parse(await balance.json())).toMatchObject({
      balanceCents: 1234,
      solanaDailyCapLamports: '0',
    });

    const checkout = await call('/v1/server/sponsoring/checkout', {
      method: 'POST',
      headers: secretHeaders,
      body: JSON.stringify({
        amountCents: 5000,
        successUrl: 'https://app.example/billing?ok=1',
        cancelUrl: 'https://app.example/billing',
      }),
    });
    expect(checkout.status, await checkout.clone().text()).toBe(201);
    const { checkoutId, url } = TopUpCheckoutOutput.parse(await checkout.json());
    expect(checkoutId).toMatch(/^cs_mock_/);
    expect(url).toContain(checkoutId);
  });

  it('validates the checkout amount and requires the secret key', async () => {
    const tooSmall = await call('/v1/server/sponsoring/checkout', {
      method: 'POST',
      headers: secretHeaders,
      body: JSON.stringify({
        amountCents: 100,
        successUrl: 'https://app.example/ok',
        cancelUrl: 'https://app.example/cancel',
      }),
    });
    await expectError(tooSmall, 400, 'validation_failed');

    const anonymous = await call('/v1/server/sponsoring/balance', { headers: withApp() });
    await expectError(anonymous, 401, 'api_key_invalid');
  });
});

describe('Solana sponsoring (T4.4)', () => {
  it('creates the fee payer once per app and reuses it', async () => {
    const first = await feePayer();
    const second = await feePayer();
    expect(second).toBe(first);
    expect(base58.decode(first)).toHaveLength(32);
    const rows = await db()
      .select()
      .from(appSystemWallets)
      .where(eq(appSystemWallets.appId, SEED.app.id));
    expect(rows).toHaveLength(1);

    const mainnet = await call('/v1/sponsor/solana/fee-payer?cluster=mainnet-beta', {
      headers: withApp(),
    });
    await expectError(mainnet, 403, 'forbidden');
    const invalid = await call('/v1/sponsor/solana/fee-payer?cluster=moon', { headers: withApp() });
    await expectError(invalid, 400, 'validation_failed');
  });

  it('refuses when the balance is too low, without broadcasting', async () => {
    await setBalance(0);
    const res = await sendSponsoredSolana(sponsoredTransfer(await feePayer(), solana.address, 1n));
    await expectError(res, 402, 'insufficient_sponsor_balance');
    expect(sentSolana).toHaveLength(0);
    expect(await balanceCents()).toBe(0);
  });

  it('charges the exact cents and broadcasts a transaction signed by the user and the fee payer', async () => {
    await setBalance(500);
    const payer = await feePayer();
    let hash = '';
    const rows = await newLedgerRows(async () => {
      const res = await sendSponsoredSolana(sponsoredTransfer(payer, solana.address, 1000n));
      expect(res.status, await res.clone().text()).toBe(200);
      const out = SendTransactionOutput.parse(await res.json());
      expect(out.sponsored).toBe(true);
      hash = out.hash;
    });

    const cents = solanaCents();
    expect(await balanceCents()).toBe(500 - cents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'charge', amountCents: -cents });

    expect(sentSolana).toHaveLength(1);
    const sent = sentSolana[0] ?? new Uint8Array();
    expect(sent[0]).toBe(2);
    const message = sent.slice(129);
    const payerSignature = sent.slice(1, 65);
    expect(ed25519.verify(payerSignature, message, base58.decode(payer))).toBe(true);
    expect(ed25519.verify(sent.slice(65, 129), message, base58.decode(solana.address))).toBe(true);
    expect(hash).toBe(base58.encode(payerSignature));

    const usage = await db()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.endUserId, login.user.id), eq(usageEvents.type, 'tx.sponsored')));
    expect(
      usage.some(
        (event) =>
          event.amount === SOLANA_FEE_LAMPORTS.toString() &&
          event.meta?.chain === 'solana' &&
          event.meta.cluster === 'devnet' &&
          event.meta.cents === cents,
      ),
    ).toBe(true);
  });

  it('refuses fee payer misuse before charging anything', async () => {
    await setBalance(500);
    const payer = await feePayer();
    const cases = [
      sponsoredTransfer(payer, solana.address, 1n, { feePayerAsAccount: true }),
      sponsoredTransfer(solana.address, payer, 1n),
    ];
    for (const transaction of cases) {
      const rows = await newLedgerRows(async () => {
        const res = await sendSponsoredSolana(transaction);
        expect(await expectError(res, 400, 'bad_request')).toEqual({ reason: 'fee_payer_misuse' });
      });
      expect(rows).toHaveLength(0);
    }
    expect(await balanceCents()).toBe(500);
    expect(sentSolana).toHaveLength(0);
  });

  it('refunds the full charge when the broadcast fails', async () => {
    await setBalance(500);
    const payer = await feePayer();
    failNextSolana = true;
    const rows = await newLedgerRows(async () => {
      const res = await sendSponsoredSolana(sponsoredTransfer(payer, solana.address, 1n));
      await expectError(res, 400, 'bad_request');
    });
    const cents = solanaCents();
    expect(rows.map((row) => [row.kind, row.amountCents])).toEqual([
      ['charge', -cents],
      ['refund', cents],
    ]);
    expect(rows[1]?.reference).toBe(`refund:${rows[0]?.reference ?? ''}`);
    expect(await balanceCents()).toBe(500);
  });

  it('enforces the daily Solana cap', async () => {
    await setBalance(500);
    const payer = await feePayer();
    const current = await call('/v1/server/sponsoring/balance', { headers: secretHeaders });
    const spent = BigInt(SponsorBalance.parse(await current.json()).solanaSpentTodayLamports);
    await updateSeedConfig({
      gasSponsoring: { ...SPONSORING_ON, solanaDailyCapLamports: (spent + 15_000n).toString() },
    });
    try {
      const send = () => sendSponsoredSolana(sponsoredTransfer(payer, solana.address, 1n));
      expect((await send()).status).toBe(200);
      const details = await expectError(await send(), 429, 'rate_limited');
      expect(details).toMatchObject({ reason: 'solana_daily_cap_reached' });
      expect(sentSolana).toHaveLength(1);
      expect(await balanceCents()).toBe(500 - solanaCents());
    } finally {
      await updateSeedConfig({ gasSponsoring: SPONSORING_ON });
    }
  });

  it('refuses a user signature over another transaction, and charges nothing in the end', async () => {
    await setBalance(500);
    const payer = await feePayer();
    const stamped = await device.transactionBody(solana, {
      chain: 'solana',
      cluster: 'devnet',
      transaction: sponsoredTransfer(payer, solana.address, 1n),
      sponsored: true,
    });
    const res = await postUser(`/v1/wallets/${solana.id}/send-transaction`, {
      input: {
        chain: 'solana',
        cluster: 'devnet',
        transaction: sponsoredTransfer(payer, solana.address, 900_000n),
        sponsored: true,
      },
      request: stamped.request,
    });
    expect(await expectError(res, 400, 'bad_request')).toMatchObject({
      reason: 'unexpected_request',
    });
    expect(sentSolana).toHaveLength(0);
    expect(await balanceCents()).toBe(500);
  });
});

describe('EVM sponsoring (T4.5)', () => {
  it('returns the smart account address, or 400 when the server has no bundler', async () => {
    const res = await getUser(`/v1/wallets/${evm.id}/smart-account?chainId=8453`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(SmartAccountOutput.parse(await res.json())).toEqual({
      chainId: 8453,
      address: SMART_ACCOUNT,
    });

    await expectError(
      await getUser(`/v1/wallets/${solana.id}/smart-account?chainId=8453`),
      400,
      'bad_request',
    );
    await expectError(
      await getUser(`/v1/wallets/${evm.id}/smart-account?chainId=5`),
      400,
      'validation_failed',
    );

    setEvmSponsorFactoryForTests(null);
    try {
      await expectError(
        await getUser(`/v1/wallets/${evm.id}/smart-account?chainId=8453`),
        400,
        'bad_request',
      );
      const { res: prepare } = await device.prepare(evm, evmSponsored());
      await expectError(prepare, 400, 'bad_request');
    } finally {
      setEvmSponsorFactoryForTests(fakeBundler);
    }
  });

  it('refuses when the balance cannot cover the maximum cost, before sending', async () => {
    await setBalance(evmMaxCents() - 1);
    await expectError(await sendSponsoredEvm(), 402, 'insufficient_sponsor_balance');
    expect(sends).toHaveLength(0);
    expect(await balanceCents()).toBe(evmMaxCents() - 1);
  });

  it('charges the maximum before sending, then refunds the unused gas after the receipt', async () => {
    await setBalance(1000);
    const maxCents = evmMaxCents();
    const actualCents = evmActualCents();
    expect(maxCents).toBeGreaterThan(actualCents);

    const rows = await newLedgerRows(async () => {
      const body = await sponsoredEvmBody();
      // Preparing charges nothing and sends nothing.
      expect(await balanceCents()).toBe(1000);
      expect(body.prepared.userOperation).toMatchObject({ sender: SMART_ACCOUNT });
      const res = await postUser(`/v1/wallets/${evm.id}/send-transaction`, body);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(SendTransactionOutput.parse(await res.json())).toEqual({
        hash: USER_OP_HASH,
        sponsored: true,
      });
      expect(sends).toHaveLength(1);
      expect(sends[0]?.balanceAtSend).toBe(1000 - maxCents);
      expect(sends[0]?.digest).toBe(body.prepared.digest);
      expect(
        await recoverAddress({
          hash: body.prepared.digest as Hex,
          signature: sends[0]?.signature ?? '0x',
        }),
      ).toBe(evm.address);
      await drainBackground();
    });

    expect(rows.map((row) => [row.kind, row.amountCents])).toEqual([
      ['charge', -maxCents],
      ['refund', maxCents - actualCents],
    ]);
    expect(await balanceCents()).toBe(1000 - actualCents);

    const walletRow = await db().query.wallets.findFirst({ where: eq(wallets.id, evm.id) });
    expect(walletRow?.smartAccountAddress).toBe(SMART_ACCOUNT);
    const usage = await db()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.endUserId, login.user.id), eq(usageEvents.type, 'tx.sponsored')));
    expect(
      usage.some(
        (event) =>
          event.amount === MAX_COST_WEI.toString() &&
          event.meta?.chain === 'evm' &&
          event.meta.chainId === 8453 &&
          event.meta.cents === maxCents,
      ),
    ).toBe(true);
  });

  it('refunds everything when the bundler rejects the operation, without leaking the key', async () => {
    await setBalance(1000);
    failNextUserOp = true;
    const rows = await newLedgerRows(async () => {
      const res = await sendSponsoredEvm();
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toContain('pim_secret');
      await drainBackground();
    });
    const maxCents = evmMaxCents();
    expect(rows.map((row) => [row.kind, row.amountCents])).toEqual([
      ['charge', -maxCents],
      ['refund', maxCents],
    ]);
    expect(await balanceCents()).toBe(1000);
  });

  it('submits only the prepared operation, once, with a signature over its digest', async () => {
    await setBalance(1000);
    const first = await sponsoredEvmBody({ value: '1' });
    const second = await sponsoredEvmBody({ value: '2' });
    expect(second.prepared.digest).not.toBe(first.prepared.digest);

    // A signature over another operation than the ticket's.
    const swapped = await postUser(`/v1/wallets/${evm.id}/send-transaction`, {
      input: first.input,
      request: second.request,
      ticket: first.ticket,
    });
    expect(await expectError(swapped, 400, 'bad_request')).toMatchObject({
      reason: 'unexpected_request',
    });
    expect(sends).toHaveLength(0);
    expect(await balanceCents()).toBe(1000);

    // Another input than the prepared one.
    const otherInput = await postUser(`/v1/wallets/${evm.id}/send-transaction`, {
      input: evmSponsored({ value: '3' }),
      request: second.request,
      ticket: second.ticket,
    });
    expect(await expectError(otherInput, 400, 'bad_request')).toMatchObject({
      reason: 'prepared_mismatch',
    });

    // No ticket at all.
    const noTicket = await postUser(`/v1/wallets/${evm.id}/send-transaction`, {
      input: second.input,
      request: second.request,
    });
    await expectError(noTicket, 400, 'bad_request');

    const ok = await sponsoredEvmBody({ value: '4' });
    expect((await postUser(`/v1/wallets/${evm.id}/send-transaction`, ok)).status).toBe(200);
    await drainBackground();
    const balance = await balanceCents();
    const replay = await newLedgerRows(async () => {
      const res = await postUser(`/v1/wallets/${evm.id}/send-transaction`, ok);
      expect(await expectError(res, 400, 'bad_request')).toMatchObject({
        reason: 'prepared_mismatch',
      });
    });
    expect(replay).toHaveLength(0);
    expect(sends).toHaveLength(1);
    expect(await balanceCents()).toBe(balance);
  });
});

describe('sponsored session sends', () => {
  const signWithSession = (sessionId: string, body: SessionSignRequestInput) =>
    postUser(`/v1/sessions/${sessionId}/sign`, body);

  const createSession = (policy: Partial<SigningPolicy>, wallet: Wallet) =>
    device.createSession(wallet, { chain: wallet.chainFamily, expiresIn: '1h', ...policy });

  const spentTotal = async (id: string) =>
    (await db().query.sessionSigners.findFirst({ where: eq(sessionSigners.id, id) }))?.spentTotal;

  it('applies the EVM policy before charging, then charges and sends', async () => {
    await setBalance(1000);
    const strict = await createSession({ maxValuePerTx: '100' }, evm);
    const refusedRaw = await signWithSession(strict.id, {
      kind: 'transaction',
      input: { chain: 'evm', chainId: 8453, to: WETH, value: '1' } as never,
      sponsored: true,
    });
    // User operations are signed as raw hashes: the session must allow that explicitly.
    expect(await expectError(refusedRaw, 403, 'policy_violation')).toEqual({
      reason: 'messages_not_allowed',
    });
    expect(sends).toHaveLength(0);

    const session = await createSession({ maxValuePerTx: '100', allowMessages: true }, evm);
    const body = (value: string): Extract<SessionSignRequestInput, { kind: 'transaction' }> => ({
      kind: 'transaction',
      input: { chain: 'evm', chainId: 8453, to: WETH, value } as never,
      sponsored: true,
    });

    const refused = await signWithSession(session.id, body('101'));
    expect(await expectError(refused, 403, 'policy_violation')).toEqual({
      reason: 'value_per_tx_exceeded',
    });
    expect(sends).toHaveLength(0);
    expect(await balanceCents()).toBe(1000);

    const res = await signWithSession(session.id, body('100'));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(SessionSignOutput.parse(await res.json())).toEqual({
      hash: USER_OP_HASH,
      sponsored: true,
    });
    expect(sends[0]?.balanceAtSend).toBe(1000 - evmMaxCents());
    expect(
      await recoverAddress({
        hash: sends[0]?.digest ?? '0x',
        signature: sends[0]?.signature ?? '0x',
      }),
    ).toBe(evm.address);
    expect(await spentTotal(session.id)).toBe('100');
    await drainBackground();
    expect(await balanceCents()).toBe(1000 - evmActualCents());

    const unbroadcast = await signWithSession(session.id, { ...body('1'), broadcast: false });
    await expectError(unbroadcast, 400, 'bad_request');
  });

  it('co-signs a Solana transaction signed under the session policy', async () => {
    await setBalance(500);
    const payer = await feePayer();
    const session = await createSession(
      { allowedPrograms: [SYSTEM_PROGRAM_ID] as never, maxValuePerTx: '50' },
      solana,
    );
    const body = (transaction: string): SessionSignRequestInput => ({
      kind: 'transaction',
      input: { chain: 'solana', cluster: 'devnet', transaction },
      sponsored: true,
    });

    const tooMuch = await signWithSession(
      session.id,
      body(sponsoredTransfer(payer, solana.address, 51n)),
    );
    expect(await expectError(tooMuch, 403, 'policy_violation')).toEqual({
      reason: 'value_per_tx_exceeded',
    });
    expect(await balanceCents()).toBe(500);

    const res = await signWithSession(
      session.id,
      body(sponsoredTransfer(payer, solana.address, 50n)),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { hash, sponsored } = SessionSignOutput.parse(await res.json());
    expect(sponsored).toBe(true);
    expect(await balanceCents()).toBe(500 - solanaCents());
    expect(await spentTotal(session.id)).toBe('50');

    const sent = sentSolana[0] ?? new Uint8Array();
    const message = sent.slice(129);
    expect(ed25519.verify(sent.slice(1, 65), message, base58.decode(payer))).toBe(true);
    expect(ed25519.verify(sent.slice(65, 129), message, base58.decode(solana.address))).toBe(true);
    expect(hash).toBe(base58.encode(sent.slice(1, 65)));
  });
});

describe('sponsoring disabled', () => {
  it('refuses sponsored sends and the fee payer with 403, and charges nothing', async () => {
    await setBalance(1000);
    const payer = await feePayer();
    const session = await device.createSession(evm, { chain: 'evm', expiresIn: '1h' });
    const prepared = await sponsoredEvmBody();
    await updateSeedConfig({ gasSponsoring: { evm: false, solana: false } });
    try {
      await expectError((await device.prepare(evm, evmSponsored())).res, 403, 'forbidden');
      // Prepared while sponsoring was on, submitted after it was turned off.
      await expectError(
        await postUser(`/v1/wallets/${evm.id}/send-transaction`, prepared),
        403,
        'forbidden',
      );
      await expectError(
        await sendSponsoredSolana(sponsoredTransfer(payer, solana.address, 1n)),
        403,
        'forbidden',
      );
      await expectError(
        await postUser(`/v1/sessions/${session.id}/sign`, {
          kind: 'transaction',
          input: { chain: 'evm', chainId: 8453, to: WETH },
          sponsored: true,
        }),
        403,
        'forbidden',
      );
      await expectError(
        await call('/v1/sponsor/solana/fee-payer?cluster=devnet', {
          headers: withApp({ Origin: EMBED_ORIGIN }),
        }),
        403,
        'forbidden',
      );
      expect(sends).toHaveLength(0);
      expect(sentSolana).toHaveLength(0);
      expect(await balanceCents()).toBe(1000);
    } finally {
      await updateSeedConfig({ gasSponsoring: SPONSORING_ON });
    }
  });
});
