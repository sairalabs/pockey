import {
  CreateWalletInput,
  EvmChainId,
  ExportWalletInput,
  ExportWalletOutput,
  PreparedOperation,
  PrepareTransactionInput,
  SendTransactionBody,
  SendTransactionOutput,
  SignMessageBody,
  SignMessageOutput,
  SignTransactionBody,
  SignTransactionOutput,
  SignTypedDataBody,
  SmartAccountOutput,
  Wallet,
  WalletList,
} from '@pockey/types';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { getRpcFactory } from '../lib/rpc.js';
import { sponsorRuntime } from '../lib/sponsor.js';
import { validate } from '../lib/validate.js';
import { requireApp } from '../middleware/app.js';
import { enforceRateLimit } from '../middleware/rate-limit.js';
import { requireUser } from '../middleware/user.js';
import {
  createWallet,
  exportWallet,
  listWallets,
  prepareOperation,
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

/**
 * Wallet routes. Every route is end-user scoped, and every signature
 * comes with the request the iframe stamped (`request`): the API relays it and
 * cannot sign anything on its own.
 */
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

  .post('/:id/sign-message', validate('json', SignMessageBody), async (c) => {
    const { input, request } = c.req.valid('json');
    const out = await signMessage(deps(c), c.var.endUserId, c.req.param('id'), input, request);
    return c.json(SignMessageOutput.parse(out));
  })

  .post('/:id/sign-typed-data', validate('json', SignTypedDataBody), async (c) => {
    const { input, request } = c.req.valid('json');
    const out = await signTypedData(deps(c), c.var.endUserId, c.req.param('id'), input, request);
    return c.json(SignMessageOutput.parse(out));
  })

  /** Nonce, gas and fees (EVM) or the sponsored user operation, for the iframe to sign. */
  .post('/:id/prepare', validate('json', PrepareTransactionInput), async (c) => {
    const { input } = c.req.valid('json');
    // Gas sponsoring abuse is capped per end user, before anything
    // talks to a bundler.
    if (input.sponsored) await enforceRateLimit(c, 'sponsoredSend', c.var.endUserId);
    const out = await prepareOperation(deps(c), c.var.endUserId, c.req.param('id'), input);
    return c.json(PreparedOperation.parse(out));
  })

  .post('/:id/sign-transaction', validate('json', SignTransactionBody), async (c) => {
    const { input, request, ticket } = c.req.valid('json');
    const out = await signTransaction(
      deps(c),
      c.var.endUserId,
      c.req.param('id'),
      input,
      request,
      ticket,
    );
    return c.json(SignTransactionOutput.parse(out));
  })

  .post('/:id/send-transaction', validate('json', SendTransactionBody), async (c) => {
    const { input, request, ticket } = c.req.valid('json');
    // Sponsored EVM sends were counted at `prepare`; Solana ones have no prepare step.
    if (input.sponsored && input.chain === 'solana') {
      await enforceRateLimit(c, 'sponsoredSend', c.var.endUserId);
    }
    const out = await sendTransaction(
      deps(c),
      c.var.endUserId,
      c.req.param('id'),
      input,
      request,
      ticket,
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
      c.req.valid('json').request,
    );
    return c.json(ExportWalletOutput.parse(out));
  });
