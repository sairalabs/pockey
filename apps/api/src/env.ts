import { z } from 'zod';

/** Worker bindings and vars. Secrets come from Wrangler, never from a committed file. */
export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  KEY_PROVIDER: string;
  BETTER_AUTH_SECRET?: string;
}

export const EnvSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
  KEY_PROVIDER: z.enum(['mock', 'turnkey']).default('mock'),
});
export type ParsedEnv = z.infer<typeof EnvSchema>;

export function parseEnv(env: Env): ParsedEnv {
  const parsed = EnvSchema.parse({ ENVIRONMENT: env.ENVIRONMENT, KEY_PROVIDER: env.KEY_PROVIDER });
  if (parsed.KEY_PROVIDER === 'mock' && parsed.ENVIRONMENT === 'production') {
    throw new Error('KEY_PROVIDER=mock is refused in production');
  }
  return parsed;
}
