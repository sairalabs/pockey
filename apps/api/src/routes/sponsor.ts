import { AppConfig, SolanaCluster, SolanaFeePayerOutput } from '@pockey/types';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { validate } from '../lib/validate.js';
import { requireApp } from '../middleware/app.js';
import { ensureSolanaFeePayer } from '../services/sponsoring.js';

export const FeePayerQuery = z.object({ cluster: SolanaCluster });

/**
 * Public sponsoring details (T4.4). Clients build sponsored Solana transactions with
 * this fee payer as account 0. The address is public, nothing here signs.
 */
export const sponsorRoutes = new Hono<AppEnv>()
  .use(requireApp)

  .get('/solana/fee-payer', validate('query', FeePayerQuery), async (c) => {
    const { cluster } = c.req.valid('query');
    const config = AppConfig.parse(c.var.app.config);
    if (!config.gasSponsoring.solana) {
      throw new ApiError('forbidden', 'Gas sponsoring is disabled for this app');
    }
    if (!config.chains.solana.includes(cluster)) {
      throw new ApiError('forbidden', `cluster ${cluster} is not enabled for this app`);
    }
    const feePayer = await ensureSolanaFeePayer(
      { db: c.var.db, keyProvider: c.var.keyProvider },
      c.var.app,
    );
    return c.json(SolanaFeePayerOutput.parse({ cluster, feePayer: feePayer.address }));
  });
