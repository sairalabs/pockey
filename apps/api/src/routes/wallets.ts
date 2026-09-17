import {
  CreateWalletInput,
  ExportWalletInput,
  EvmChainId,
  ExportWalletOutput,
  SendTransactionInput,
  SendTransactionOutput,
  SignMessageInput,
  SignMessageOutput,
  SignTransactionOutput,
  SignTypedDataInput,
  SmartAccountOutput,
  TransactionRequest,
  Wallet,
  WalletList,
} from '@pocketkey/types';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { getRpcFactory } from '../lib/rpc.js';
import { sponsorRuntime } from '../lib/sponsor.js';
import { validate } from '../lib/validate.js';
import { requireApp } from '../middleware/app.js';
import { requireUser } from '../middleware/user.js';
import {
  createWallet,
  exportWallet,
  listWallets,
  sendTransaction,
  signMessage,
  signTransaction,
  signTypedData,
  smartAccountAddress,
  toWallet,
  type WalletDeps,
} from '../services/wallets.js';

const deps = (c: Context<AppEnv>): WalletDeps => ({
  db: c.var.db,
  keyProvider: c.var.keyProvider,
  rpc: getRpcFactory(c.var.config),
  app: c.var.app,
  sponsor: sponsorRuntime(c),
});

export const SmartAccountQuery = z.object({ chainId: z.coerce.number().pipe(EvmChainId) });

/** Section 7.2 wallet routes. Every route is end-user scoped. */
export const walletRoutes = new Hono<AppEnv>()
  .use(requireApp, requireUser)

  .post('/', validate('json', CreateWalletInput), async (c) => {
    const row = await createWallet(deps(c), c.var.endUserId, c.req.valid('json').chainFamily);
    return c.json(Wallet.parse(toWallet(row)), 201);
  })

  .get('/', async (c) => {
    const rows = await listWallets(deps(c), c.var.endUserId);
    return c.json(WalletList.parse({ wallets: rows.map(toWallet) }));
  })

  .post('/:id/sign-message', validate('json', SignMessageInput), async (c) => {
    const out = await signMessage(deps(c), c.var.endUserId, c.req.param('id'), c.req.valid('json'));
    return c.json(SignMessageOutput.parse(out));
  })

  .post('/:id/sign-typed-data', validate('json', SignTypedDataInput), async (c) => {
    const out = await signTypedData(
      deps(c),
      c.var.endUserId,
      c.req.param('id'),
      c.req.valid('json'),
    );
    return c.json(SignMessageOutput.parse(out));
  })

  .post('/:id/sign-transaction', validate('json', TransactionRequest), async (c) => {
    const out = await signTransaction(
      deps(c),
      c.var.endUserId,
      c.req.param('id'),
      c.req.valid('json'),
    );
    return c.json(SignTransactionOutput.parse(out));
  })

  .post('/:id/send-transaction', validate('json', SendTransactionInput), async (c) => {
    const out = await sendTransaction(
      deps(c),
      c.var.endUserId,
      c.req.param('id'),
      c.req.valid('json'),
    );
    return c.json(SendTransactionOutput.parse(out));
  })

  .get('/:id/smart-account', validate('query', SmartAccountQuery), async (c) => {
    const { chainId } = c.req.valid('query');
    const address = await smartAccountAddress(deps(c), c.var.endUserId, c.req.param('id'), chainId);
    return c.json(SmartAccountOutput.parse({ chainId, address }));
  })

  .post('/:id/export', validate('json', ExportWalletInput), async (c) => {
    const out = await exportWallet(
      deps(c),
      c.var.endUserId,
      c.req.param('id'),
      c.req.valid('json').targetPublicKey,
    );
    return c.json(ExportWalletOutput.parse(out));
  });
