import { z } from 'zod';

/** Worker bindings and vars. Secrets come from Wrangler, never from a committed file. */
export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  KEY_PROVIDER: string;
  /** Public base URL of this API, used for OAuth callbacks. */
  API_BASE_URL?: string;
  /** Origin of the embed iframe (section 4.1). Passkeys are bound to its host. */
  EMBED_ORIGIN?: string;
  MAILER?: string;
  MAIL_FROM?: string;
  /* Secrets (wrangler secret put / .dev.vars) */
  BETTER_AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_APP_BUNDLE_IDENTIFIER?: string;
  /** Local development only: makes mock wallets survive restarts. */
  MOCK_KEY_SEED?: string;
  /** JSON map of RPC endpoints (may embed provider keys, so set it as a secret). */
  RPC_URLS?: string;
}

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const EnvSchema = z
  .object({
    ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    KEY_PROVIDER: z.enum(['mock', 'turnkey']).default('mock'),
    API_BASE_URL: z.url().default('http://localhost:8787'),
    EMBED_ORIGIN: z.url().default('http://localhost:5174'),
    MAILER: z.enum(['console', 'memory', 'resend']).default('console'),
    MAIL_FROM: z.string().default('Pocketkey <auth@pocketkey.dev>'),
    BETTER_AUTH_SECRET: z
      .string({ error: 'BETTER_AUTH_SECRET is required (wrangler secret or .dev.vars)' })
      .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
    RESEND_API_KEY: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    APPLE_CLIENT_ID: optionalString,
    APPLE_CLIENT_SECRET: optionalString,
    APPLE_APP_BUNDLE_IDENTIFIER: optionalString,
    MOCK_KEY_SEED: optionalString,
    /**
     * JSON map of RPC endpoints, e.g. {"8453":"https://base...","solana:devnet":"https://..."}.
     * Missing entries fall back to public RPCs, fine for development only.
     */
    RPC_URLS: z
      .string()
      .optional()
      .transform((raw, ctx) => {
        if (!raw) return {};
        try {
          return z.record(z.string(), z.url()).parse(JSON.parse(raw));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'RPC_URLS must be a JSON object of URLs' });
          return z.NEVER;
        }
      }),
  })
  .superRefine((env, ctx) => {
    if (env.ENVIRONMENT === 'production') {
      if (env.KEY_PROVIDER === 'mock') {
        ctx.addIssue({ code: 'custom', message: 'KEY_PROVIDER=mock is refused in production' });
      }
      if (env.MAILER !== 'resend') {
        ctx.addIssue({ code: 'custom', message: 'MAILER must be resend in production' });
      }
      if (env.MOCK_KEY_SEED) {
        ctx.addIssue({ code: 'custom', message: 'MOCK_KEY_SEED must not be set in production' });
      }
    }
    if (env.MAILER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', message: 'RESEND_API_KEY is required when MAILER=resend' });
    }
  });
export type ParsedEnv = z.infer<typeof EnvSchema>;

// Bindings are constant for the life of an isolate, so parse once.
const cache = new WeakMap<object, ParsedEnv>();

export function parseEnv(env: Env): ParsedEnv {
  const hit = cache.get(env);
  if (hit) return hit;
  const result = EnvSchema.safeParse({
    ENVIRONMENT: env.ENVIRONMENT,
    KEY_PROVIDER: env.KEY_PROVIDER,
    API_BASE_URL: env.API_BASE_URL,
    EMBED_ORIGIN: env.EMBED_ORIGIN,
    MAILER: env.MAILER,
    MAIL_FROM: env.MAIL_FROM,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    RESEND_API_KEY: env.RESEND_API_KEY,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: env.APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: env.APPLE_CLIENT_SECRET,
    APPLE_APP_BUNDLE_IDENTIFIER: env.APPLE_APP_BUNDLE_IDENTIFIER,
    MOCK_KEY_SEED: env.MOCK_KEY_SEED,
    RPC_URLS: env.RPC_URLS,
  });
  if (!result.success) {
    // Messages only, never the values: some of these are secrets.
    const reasons = result.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid Worker configuration: ${reasons}`);
  }
  cache.set(env, result.data);
  return result.data;
}
