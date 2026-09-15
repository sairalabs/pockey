import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';

export const HealthResponse = z.object({
  ok: z.literal(true),
  environment: z.string(),
  keyProvider: z.string(),
  db: z.literal('ok'),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const health = new Hono<AppEnv>().get('/', async (c) => {
  await c.var.db.run(sql`select 1`);
  const body: HealthResponse = {
    ok: true,
    environment: c.var.config.ENVIRONMENT,
    keyProvider: c.var.config.KEY_PROVIDER,
    db: 'ok',
    time: new Date().toISOString(),
  };
  return c.json(HealthResponse.parse(body));
});
