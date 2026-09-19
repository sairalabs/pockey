import { ed25519 } from '@noble/curves/ed25519.js';
import type { EvmRpc } from '@pocketkey/chains-evm';
import type { SolanaRpc } from '@pocketkey/chains-solana';
import { usageEvents } from '@pocketkey/db';
import { buildSignRaw, buildSignTransaction } from '@pocketkey/key-provider/client';
import { decryptExport } from '@pocketkey/key-provider/client/crypto';
import {
  ApiErrorBody,
  ExportWalletOutput,
  SendTransactionOutput,
  SignMessageOutput,
  SignTransactionOutput,
  Wallet,
  WalletList,
  type AuthResponse,
} from '@pocketkey/types';
import { base58, base64 } from '@scure/base';
import { and, eq } from 'drizzle-orm';
import {
  hexToBytes,
  parseTransaction,
  recoverTransactionAddress,
  serializeTransaction,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setRpcFactory } from '../src/lib/rpc.js';
import { appConfig, type Device } from './device.js';
import { bearer, createTestApp, db, loginWithEmail, request, seedDb } from './helpers.js';

/* Fake RPCs: nothing leaves the test, everything sent is captured. */
const sentEvm: Hex[] = [];
const sentSolana: Uint8Array[] = [];
const fakeEvm: EvmRpc = {
  getTransactionCount: async () => 7,
  estimateGas: async () => 21_000n,
  estimateFeesPerGas: async () => ({
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  }),
  sendRawTransaction: async (serialized) => {
    sentEvm.push(serialized);
    return '0xabababababababababababababababababababababababababababababababab';
  },
};
const fakeSolana: SolanaRpc = {
  getLatestBlockhash: async () => ({
    blockhash: base58.encode(new Uint8Array(32).fill(9)),
    lastValidBlockHeight: 1,
  }),
  sendRawTransaction: async (bytes) => {
    sentSolana.push(bytes);
    return 'ignored-by-the-api';
  },
};

const WETH = '0x4200000000000000000000000000000000000006';

let login: AuthResponse;
let device: Device;
let evm: Wallet;
let solana: Wallet;

const post = (path: string, body: unknown, token = login.accessToken) =>
  request(path, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function expectReason(res: Response, status: number, reason: string): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(status);
  expect(ApiErrorBody.parse(await res.json()).error.details).toMatchObject({ reason });
}

beforeAll(async () => {
  await seedDb();
  setRpcFactory({ evm: () => fakeEvm, solana: () => fakeSolana });
  ({ body: login, device } = await loginWithEmail('wallets@test.dev'));
  evm = device.wallet('evm');
  solana = device.wallet('solana');
});

afterAll(() => {
  setRpcFactory(undefined);
});

beforeEach(() => {
  sentEvm.length = 0;
  sentSolana.length = 0;
});

/** Prepared EVM body: input, stamped request, ticket and what was prepared. */
async function evmBody(owner: Device, wallet: Wallet, input: Record<string, unknown>) {
  const out = await owner.transactionBody(wallet, input);
  if (!('prepared' in out) || out.prepared.kind !== 'transaction') {
    throw new Error('expected a prepared transaction');
  }
  return { input: out.input, request: out.request, ticket: out.ticket, prepared: out.prepared };
}

/** Legacy transfer from `payer` built by hand: header, 3 keys, blockhash, 1 instruction. */
function unsignedSolanaTransfer(payer: string, lamports: bigint): string {
  const keys = [
    base58.decode(payer),
    ed25519.getPublicKey(ed25519.utils.randomSecretKey()),
    new Uint8Array(32),
  ];
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // SystemProgram.transfer
  view.setBigUint64(4, lamports, true);
  const message = Uint8Array.from([
    1,
    0,
    1, // header
    3,
    ...keys.flatMap((key) => [...key]),
    ...new Uint8Array(32).fill(7), // recent blockhash
    1,
    2,
    2,
    0,
    1,
    data.length,
    ...data, // one instruction
  ]);
  return base64.encode(Uint8Array.from([1, ...new Uint8Array(64), ...message]));
}

describe('wallet creation (T2.3)', () => {
  it('creates an EVM and a Solana wallet at login when createOnLogin is "all"', async () => {
    expect(evm.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(base58.decode(solana.address)).toHaveLength(32);
    expect(evm.address).toBe(device.keySession.accounts.evm.address);
    expect(solana.address).toBe(device.keySession.accounts.solana.address);

    const list = await request('/v1/wallets', { headers: bearer(login.accessToken) });
    expect(WalletList.parse(await list.json()).wallets).toHaveLength(2);

    const events = await db()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.endUserId, login.user.id), eq(usageEvents.type, 'wallet.created')));
    expect(events).toHaveLength(2);
  });

  it('does not create wallets twice on the next login', async () => {
    const again = (await loginWithEmail('wallets@test.dev')).body;
    expect(again.user.wallets.map((w) => w.id).sort()).toEqual([evm.id, solana.id].sort());
  });

  it('refuses a second wallet of the same family', async () => {
    const res = await post('/v1/wallets', { chainFamily: 'evm' });
    expect(res.status).toBe(409);
  });

  it('creates wallets on demand when the app turned createOnLogin off', async () => {
    const other = await createTestApp({
      loginMethods: ['email'],
      embeddedWallets: { createOnLogin: 'off' },
    });
    const { body } = await loginWithEmail('lazy@test.dev', {
      publicId: other.publicId,
      origin: 'https://other.example',
    });
    expect(body.user.wallets).toEqual([]);

    const res = await request('/v1/wallets', {
      method: 'POST',
      headers: { ...bearer(body.accessToken, other.publicId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainFamily: 'solana' }),
    });
    expect(res.status).toBe(201);
    const wallet = Wallet.parse(await res.json());
    expect(wallet.chainFamily).toBe('solana');
    // The account already existed at the provider since sign-up.
    expect(wallet.address).toBe(body.keySession.accounts.solana.address);
  });
});

describe('EVM signing (T2.1 + T2.3)', () => {
  it('signs a personal message that viem verifies against the wallet address', async () => {
    const res = await post(
      `/v1/wallets/${evm.id}/sign-message`,
      await device.signMessageBody(evm, { chain: 'evm', message: 'gm pocketkey' }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature } = SignMessageOutput.parse(await res.json());
    expect(
      await verifyMessage({
        address: evm.address as Address,
        message: 'gm pocketkey',
        signature: signature as Hex,
      }),
    ).toBe(true);

    const raw = await post(
      `/v1/wallets/${evm.id}/sign-message`,
      await device.signMessageBody(evm, { chain: 'evm', message: { raw: '0xdeadbeef' } }),
    );
    const rawSig = SignMessageOutput.parse(await raw.json()).signature as Hex;
    expect(
      await verifyMessage({
        address: evm.address as Address,
        message: { raw: '0xdeadbeef' },
        signature: rawSig,
      }),
    ).toBe(true);
  });

  it('signs EIP-712 typed data', async () => {
    const typed = {
      domain: {
        name: 'Pocketkey',
        version: '1',
        chainId: 8453,
        verifyingContract: WETH,
      },
      types: {
        Mail: [
          { name: 'to', type: 'address' },
          { name: 'contents', type: 'string' },
        ],
      },
      primaryType: 'Mail',
      message: { to: WETH, contents: 'hello' },
    } as const;
    const res = await post(
      `/v1/wallets/${evm.id}/sign-typed-data`,
      await device.signTypedDataBody(evm, { chain: 'evm', ...typed } as never),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature } = SignMessageOutput.parse(await res.json());
    expect(
      await verifyTypedData({
        address: evm.address as Address,
        ...typed,
        signature: signature as Hex,
      }),
    ).toBe(true);
  });

  it('prepares an EIP-1559 transaction from the RPC and signs exactly that one', async () => {
    const {
      input,
      request: stamped,
      ticket,
      prepared,
    } = await evmBody(device, evm, {
      chain: 'evm',
      chainId: 8453,
      to: WETH,
      value: '1000',
    });
    const unsigned = parseTransaction(prepared.unsignedTransaction as Hex);
    expect(unsigned).toMatchObject({ chainId: 8453, nonce: 7, value: 1000n, to: WETH });

    const res = await post(`/v1/wallets/${evm.id}/sign-transaction`, {
      input,
      request: stamped,
      ticket,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { signedTransaction } = SignTransactionOutput.parse(await res.json());
    const parsed = parseTransaction(signedTransaction as Hex);
    expect(parsed.chainId).toBe(8453);
    expect(parsed.nonce).toBe(7);
    expect(parsed.value).toBe(1000n);
    expect(
      await recoverTransactionAddress({ serializedTransaction: signedTransaction as never }),
    ).toBe(evm.address);
    expect(sentEvm).toHaveLength(0);
  });

  it('sends a transaction and records usage', async () => {
    const {
      input,
      request: stamped,
      ticket,
    } = await evmBody(device, evm, {
      chain: 'evm',
      chainId: 84532,
      to: WETH,
    });
    const res = await post(`/v1/wallets/${evm.id}/send-transaction`, {
      input,
      request: stamped,
      ticket,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(SendTransactionOutput.parse(await res.json())).toEqual({
      hash: '0xabababababababababababababababababababababababababababababababab',
      sponsored: false,
    });
    expect(sentEvm).toHaveLength(1);
    expect(await recoverTransactionAddress({ serializedTransaction: sentEvm[0] as never })).toBe(
      evm.address,
    );

    const events = await db()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.endUserId, login.user.id), eq(usageEvents.type, 'tx.signed')));
    expect(events.some((event) => event.meta?.broadcast === true)).toBe(true);
  });

  it('refuses a chain the app did not enable, disabled sponsoring, and the wrong family', async () => {
    const mainnet = await device.prepare(evm, { chain: 'evm', chainId: 1, to: WETH });
    expect(mainnet.res.status).toBe(403);

    const sponsored = await device.prepare(evm, {
      chain: 'evm',
      chainId: 8453,
      to: WETH,
      sponsored: true,
    });
    // The seed app keeps gas sponsoring off (sponsoring.test.ts covers the enabled paths).
    expect(sponsored.res.status).toBe(403);

    const typed = await device.signTypedDataBody(evm, {
      chain: 'evm',
      domain: { name: 'X' },
      types: { Ping: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Ping',
      message: { value: '1' },
    });
    const wrongFamily = await post(`/v1/wallets/${solana.id}/sign-typed-data`, typed);
    expect(wrongFamily.status).toBe(400);
    const wrongPrepare = await device.prepare(solana, { chain: 'evm', chainId: 8453, to: WETH });
    expect(wrongPrepare.res.status).toBe(400);
    expect(sentEvm).toHaveLength(0);
  });
});

describe('relayed requests must match the route', () => {
  const evmTx = { chain: 'evm', chainId: 8453, to: WETH, value: '5' } as const;

  it('refuses a request that signs another message or with another account', async () => {
    const other = await device.signMessageBody(evm, { chain: 'evm', message: 'drain me' });
    await expectReason(
      await post(`/v1/wallets/${evm.id}/sign-message`, {
        input: { chain: 'evm', message: 'gm' },
        request: other.request,
      }),
      400,
      'unexpected_request',
    );

    // Right digest, but stamped for the Solana account of the same user.
    const legit = await device.signMessageBody(evm, { chain: 'evm', message: 'gm' });
    const body = JSON.parse(legit.request.body) as { parameters: { payload: string } };
    const otherAccount = await device.stamp(
      buildSignRaw({
        organizationId: device.keySession.organizationId,
        address: solana.address,
        payload: hexToBytes(`0x${body.parameters.payload.replace(/^0x/, '')}`),
        encoding: 'hash',
      }),
    );
    await expectReason(
      await post(`/v1/wallets/${evm.id}/sign-message`, {
        input: legit.input,
        request: otherAccount,
      }),
      400,
      'unexpected_request',
    );

    // A Solana message request relayed on the typed data route.
    const solanaMessage = await device.signMessageBody(solana, {
      chain: 'solana',
      message: base64.encode(new TextEncoder().encode('gm')),
    });
    await expectReason(
      await post(`/v1/wallets/${evm.id}/sign-typed-data`, {
        input: {
          chain: 'evm',
          domain: { name: 'X' },
          types: { Ping: [{ name: 'value', type: 'uint256' }] },
          primaryType: 'Ping',
          message: { value: '1' },
        },
        request: solanaMessage.request,
      }),
      400,
      'unexpected_request',
    );
  });

  it('refuses a stamp that does not cover the body', async () => {
    const legit = await device.signMessageBody(evm, { chain: 'evm', message: 'gm' });
    const other = await device.signMessageBody(evm, { chain: 'evm', message: 'drain me' });
    const res = await post(`/v1/wallets/${evm.id}/sign-message`, {
      input: other.input,
      request: { ...other.request, stamp: legit.request.stamp },
    });
    expect(res.status, await res.clone().text()).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(sentEvm).toHaveLength(0);
  });

  it('only signs the prepared transaction, once, for the same input', async () => {
    const first = await evmBody(device, evm, evmTx);
    const second = await evmBody(device, evm, { ...evmTx, value: '6' });

    // A request for another transaction than the one prepared under this ticket.
    await expectReason(
      await post(`/v1/wallets/${evm.id}/send-transaction`, {
        input: first.input,
        request: second.request,
        ticket: first.ticket,
      }),
      400,
      'unexpected_request',
    );
    // The ticket was consumed by the refused attempt.
    await expectReason(
      await post(`/v1/wallets/${evm.id}/send-transaction`, {
        input: first.input,
        request: first.request,
        ticket: first.ticket,
      }),
      400,
      'prepared_mismatch',
    );

    // Another input than the prepared one.
    await expectReason(
      await post(`/v1/wallets/${evm.id}/send-transaction`, {
        input: { ...evmTx, value: '7' },
        request: second.request,
        ticket: second.ticket,
      }),
      400,
      'prepared_mismatch',
    );

    const ok = await evmBody(device, evm, evmTx);
    const send = () =>
      post(`/v1/wallets/${evm.id}/send-transaction`, {
        input: ok.input,
        request: ok.request,
        ticket: ok.ticket,
      });
    expect((await send()).status).toBe(200);
    await expectReason(await send(), 400, 'prepared_mismatch');
    expect(sentEvm).toHaveLength(1);
  });

  it('refuses EVM transactions without a ticket and a transaction built by hand', async () => {
    const noTicket = await evmBody(device, evm, evmTx);
    const res = await post(`/v1/wallets/${evm.id}/sign-transaction`, {
      input: noTicket.input,
      request: noTicket.request,
    });
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('bad_request');

    // The iframe stamps its own transaction (other nonce) instead of the prepared one.
    const prepared = await device.prepare(evm, evmTx);
    if (prepared.prepared?.kind !== 'transaction') throw new Error('expected a transaction');
    const handmade = await device.stamp(
      buildSignTransaction({
        organizationId: device.keySession.organizationId,
        address: evm.address,
        chainFamily: 'evm',
        unsignedTransaction: serializeTransaction({
          ...parseTransaction(prepared.prepared.unsignedTransaction as Hex),
          nonce: 8,
        } as never),
      }),
    );
    await expectReason(
      await post(`/v1/wallets/${evm.id}/sign-transaction`, {
        input: evmTx,
        request: handmade,
        ticket: prepared.prepared.ticket,
      }),
      400,
      'unexpected_request',
    );
    expect(sentEvm).toHaveLength(0);
  });

  it("does not accept another user's ticket", async () => {
    const { device: stranger } = await loginWithEmail('ticket-thief@test.dev');
    const theirs = await evmBody(stranger, stranger.wallet('evm'), evmTx);
    const mine = await evmBody(device, evm, evmTx);
    await expectReason(
      await post(`/v1/wallets/${evm.id}/send-transaction`, {
        input: mine.input,
        request: mine.request,
        ticket: theirs.ticket,
      }),
      400,
      'prepared_mismatch',
    );
  });
});

describe('Solana signing (T2.2 + T2.3)', () => {
  it('prepares nothing for Solana', async () => {
    const transaction = unsignedSolanaTransfer(solana.address, 1n);
    const { res, prepared } = await device.prepare(solana, {
      chain: 'solana',
      cluster: 'devnet',
      transaction,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(prepared).toEqual({ kind: 'none' });
  });

  it('signs a message that verifies with the wallet public key', async () => {
    const message = base64.encode(new TextEncoder().encode('gm solana'));
    const res = await post(
      `/v1/wallets/${solana.id}/sign-message`,
      await device.signMessageBody(solana, { chain: 'solana', message }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature } = SignMessageOutput.parse(await res.json());
    expect(
      ed25519.verify(
        base64.decode(signature),
        base64.decode(message),
        base58.decode(solana.address),
      ),
    ).toBe(true);
  });

  it('signs and sends a transfer, returning the signature as the id', async () => {
    const transaction = unsignedSolanaTransfer(solana.address, 5_000n);
    const res = await post(
      `/v1/wallets/${solana.id}/send-transaction`,
      await device.transactionBody(solana, { chain: 'solana', cluster: 'devnet', transaction }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const { hash } = SendTransactionOutput.parse(await res.json());

    expect(sentSolana).toHaveLength(1);
    const sent = sentSolana[0] ?? new Uint8Array();
    const signature = sent.slice(1, 65);
    const messageBytes = sent.slice(65);
    expect(ed25519.verify(signature, messageBytes, base58.decode(solana.address))).toBe(true);
    expect(hash).toBe(base58.encode(signature));
  });

  it('refuses a request for another transaction than the input', async () => {
    const stamped = await device.transactionBody(solana, {
      chain: 'solana',
      cluster: 'devnet',
      transaction: unsignedSolanaTransfer(solana.address, 1n),
    });
    await expectReason(
      await post(`/v1/wallets/${solana.id}/send-transaction`, {
        input: {
          chain: 'solana',
          cluster: 'devnet',
          transaction: unsignedSolanaTransfer(solana.address, 1_000_000n),
        },
        request: stamped.request,
      }),
      400,
      'unexpected_request',
    );
    expect(sentSolana).toHaveLength(0);
  });

  it('refuses a cluster the app did not enable and a transaction for another signer', async () => {
    const transaction = unsignedSolanaTransfer(solana.address, 1n);
    const mainnet = await post(
      `/v1/wallets/${solana.id}/sign-transaction`,
      await device.transactionBody(solana, {
        chain: 'solana',
        cluster: 'mainnet-beta',
        transaction,
      }),
    );
    expect(mainnet.status).toBe(403);

    const stranger = base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    const foreign = await post(
      `/v1/wallets/${solana.id}/sign-transaction`,
      await device.transactionBody(solana, {
        chain: 'solana',
        cluster: 'devnet',
        transaction: unsignedSolanaTransfer(stranger, 1n),
      }),
    );
    expect(foreign.status, await foreign.clone().text()).toBe(400);
  });
});

describe('ownership and export', () => {
  it('hides wallets of other users behind a 404', async () => {
    const { body: stranger, device: strangerDevice } = await loginWithEmail('stranger@test.dev');
    const res = await post(
      `/v1/wallets/${evm.id}/sign-message`,
      await strangerDevice.signMessageBody(evm, { chain: 'evm', message: 'mine now' }),
      stranger.accessToken,
    );
    expect(res.status).toBe(404);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('not_found');

    const prepare = await strangerDevice.prepare(evm, { chain: 'evm', chainId: 8453, to: WETH });
    expect(prepare.res.status).toBe(404);
    const exported = await post(
      `/v1/wallets/${evm.id}/export`,
      (await strangerDevice.exportBody(evm)).body,
      stranger.accessToken,
    );
    expect(exported.status).toBe(404);
  });

  it("refuses a request stamped by another user's session key for this wallet", async () => {
    const { device: stranger } = await loginWithEmail('forger@test.dev');
    const forged = await stranger.stamp(
      buildSignRaw({
        organizationId: device.keySession.organizationId,
        address: evm.address,
        payload: new Uint8Array(32).fill(1),
        encoding: 'hash',
      }),
    );
    const res = await post(`/v1/wallets/${evm.id}/sign-message`, {
      input: { chain: 'evm', message: { raw: `0x${'01'.repeat(32)}` } },
      request: forged,
    });
    expect(res.status, await res.clone().text()).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('relays an export bundle only the iframe key can open (T2.4)', async () => {
    const config = await appConfig();
    for (const wallet of [evm, solana]) {
      const { body, exportKey } = await device.exportBody(wallet);
      const res = await post(`/v1/wallets/${wallet.id}/export`, body);
      expect(res.status, await res.clone().text()).toBe(200);
      const { encryptedBundle } = ExportWalletOutput.parse(await res.json());
      expect(encryptedBundle).not.toContain(wallet.address);

      const secret = await decryptExport({
        exportBundle: encryptedBundle,
        key: exportKey,
        organizationId: device.keySession.organizationId,
        chainFamily: wallet.chainFamily,
        ...(config.keyProvider.enclaveSignerPublicKey
          ? { enclaveSignerPublicKey: config.keyProvider.enclaveSignerPublicKey }
          : {}),
      });
      if (wallet.chainFamily === 'evm') {
        expect(privateKeyToAddress(secret as Hex)).toBe(wallet.address);
      } else {
        const bytes = base58.decode(secret);
        expect(base58.encode(bytes.slice(32))).toBe(wallet.address);
      }
    }
  });

  it('refuses an export request for another account than the route', async () => {
    const { body } = await device.exportBody(solana);
    await expectReason(await post(`/v1/wallets/${evm.id}/export`, body), 400, 'unexpected_request');
  });

  it('requires a signed-in user', async () => {
    const res = await request('/v1/wallets', {
      headers: { 'X-Pocketkey-App-Id': 'pk_app_seed00000000000000000001' },
    });
    expect(res.status).toBe(401);
  });
});
