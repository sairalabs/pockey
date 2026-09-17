import { ed25519 } from '@noble/curves/ed25519.js';
import type { EvmRpc } from '@pocketkey/chains-evm';
import type { SolanaRpc } from '@pocketkey/chains-solana';
import { usageEvents } from '@pocketkey/db';
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
  parseTransaction,
  recoverTransactionAddress,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setRpcFactory } from '../src/lib/rpc.js';
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

let login: AuthResponse;
let evm: Wallet;
let solana: Wallet;

const post = (path: string, body: unknown, token = login.accessToken) =>
  request(path, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await seedDb();
  setRpcFactory({ evm: () => fakeEvm, solana: () => fakeSolana });
  login = (await loginWithEmail('wallets@test.dev')).body;
  const byFamily = (family: string) => {
    const wallet = login.user.wallets.find((w) => w.chainFamily === family);
    if (!wallet) throw new Error(`missing ${family} wallet`);
    return wallet;
  };
  evm = byFamily('evm');
  solana = byFamily('solana');
});

afterAll(() => {
  setRpcFactory(undefined);
});

beforeEach(() => {
  sentEvm.length = 0;
  sentSolana.length = 0;
});

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
    expect(Wallet.parse(await res.json()).chainFamily).toBe('solana');
  });
});

describe('EVM signing (T2.1 + T2.3)', () => {
  it('signs a personal message that viem verifies against the wallet address', async () => {
    const res = await post(`/v1/wallets/${evm.id}/sign-message`, {
      chain: 'evm',
      message: 'gm pocketkey',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { signature } = SignMessageOutput.parse(await res.json());
    expect(
      await verifyMessage({
        address: evm.address as Address,
        message: 'gm pocketkey',
        signature: signature as Hex,
      }),
    ).toBe(true);

    const raw = await post(`/v1/wallets/${evm.id}/sign-message`, {
      chain: 'evm',
      message: { raw: '0xdeadbeef' },
    });
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
        verifyingContract: '0x4200000000000000000000000000000000000006',
      },
      types: {
        Mail: [
          { name: 'to', type: 'address' },
          { name: 'contents', type: 'string' },
        ],
      },
      primaryType: 'Mail',
      message: { to: '0x4200000000000000000000000000000000000006', contents: 'hello' },
    } as const;
    const res = await post(`/v1/wallets/${evm.id}/sign-typed-data`, { chain: 'evm', ...typed });
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

  it('signs an EIP-1559 transaction filled from the RPC and recoverable to the wallet', async () => {
    const res = await post(`/v1/wallets/${evm.id}/sign-transaction`, {
      chain: 'evm',
      chainId: 8453,
      to: '0x4200000000000000000000000000000000000006',
      value: '1000',
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
    const res = await post(`/v1/wallets/${evm.id}/send-transaction`, {
      chain: 'evm',
      chainId: 84532,
      to: '0x4200000000000000000000000000000000000006',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(SendTransactionOutput.parse(await res.json())).toEqual({
      hash: '0xabababababababababababababababababababababababababababababababab',
      sponsored: false,
    });
    expect(sentEvm).toHaveLength(1);
  });

  it('refuses a chain the app did not enable, disabled sponsoring, and the wrong family', async () => {
    const mainnet = await post(`/v1/wallets/${evm.id}/send-transaction`, {
      chain: 'evm',
      chainId: 1,
      to: '0x4200000000000000000000000000000000000006',
    });
    expect(mainnet.status).toBe(403);

    const sponsored = await post(`/v1/wallets/${evm.id}/send-transaction`, {
      chain: 'evm',
      chainId: 8453,
      to: '0x4200000000000000000000000000000000000006',
      sponsored: true,
    });
    // The seed app keeps gas sponsoring off (sponsoring.test.ts covers the enabled paths).
    expect(sponsored.status).toBe(403);

    const wrongFamily = await post(`/v1/wallets/${solana.id}/sign-typed-data`, {
      chain: 'evm',
      domain: {},
      types: {},
      primaryType: 'X',
      message: {},
    });
    expect(wrongFamily.status).toBe(400);
    expect(sentEvm).toHaveLength(0);
  });
});

describe('Solana signing (T2.2 + T2.3)', () => {
  it('signs a message that verifies with the wallet public key', async () => {
    const message = base64.encode(new TextEncoder().encode('gm solana'));
    const res = await post(`/v1/wallets/${solana.id}/sign-message`, { chain: 'solana', message });
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
    const res = await post(`/v1/wallets/${solana.id}/send-transaction`, {
      chain: 'solana',
      cluster: 'devnet',
      transaction,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { hash } = SendTransactionOutput.parse(await res.json());

    expect(sentSolana).toHaveLength(1);
    const sent = sentSolana[0] ?? new Uint8Array();
    const signature = sent.slice(1, 65);
    const messageBytes = sent.slice(65);
    expect(ed25519.verify(signature, messageBytes, base58.decode(solana.address))).toBe(true);
    expect(hash).toBe(base58.encode(signature));
  });

  it('refuses a cluster the app did not enable and a transaction for another signer', async () => {
    const transaction = unsignedSolanaTransfer(solana.address, 1n);
    const mainnet = await post(`/v1/wallets/${solana.id}/sign-transaction`, {
      chain: 'solana',
      cluster: 'mainnet-beta',
      transaction,
    });
    expect(mainnet.status).toBe(403);

    const stranger = base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
    const foreign = await post(`/v1/wallets/${solana.id}/sign-transaction`, {
      chain: 'solana',
      cluster: 'devnet',
      transaction: unsignedSolanaTransfer(stranger, 1n),
    });
    expect(foreign.status).toBe(400);
  });
});

describe('ownership and export', () => {
  it('hides wallets of other users behind a 404', async () => {
    const stranger = (await loginWithEmail('stranger@test.dev')).body;
    const res = await post(
      `/v1/wallets/${evm.id}/sign-message`,
      { chain: 'evm', message: 'mine now' },
      stranger.accessToken,
    );
    expect(res.status).toBe(404);
    expect(ApiErrorBody.parse(await res.json()).error.code).toBe('not_found');
  });

  it('relays an encrypted export bundle (T2.4)', async () => {
    const res = await post(`/v1/wallets/${evm.id}/export`, {
      targetPublicKey: base64.encode(new Uint8Array(65).fill(4)),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { encryptedBundle } = ExportWalletOutput.parse(await res.json());
    expect(encryptedBundle.length).toBeGreaterThan(0);
    expect(encryptedBundle).not.toContain(evm.address);
  });

  it('requires a signed-in user', async () => {
    const res = await request('/v1/wallets', {
      headers: { 'X-Pocketkey-App-Id': 'pk_app_seed00000000000000000001' },
    });
    expect(res.status).toBe(401);
  });
});
