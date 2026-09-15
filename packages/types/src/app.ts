import { z } from 'zod';
import { EvmChainId, SolanaCluster } from './chains.js';
import { AppId, DeveloperId, PublicAppId } from './ids.js';

export const LoginMethod = z.enum(['email', 'google', 'apple', 'passkey', 'wallet']);
export type LoginMethod = z.infer<typeof LoginMethod>;

export const CreateOnLogin = z.enum(['all', 'evm', 'solana', 'off']);
export type CreateOnLogin = z.infer<typeof CreateOnLogin>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a 6-digit hex color');

export const Appearance = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  accent: HexColor.default('#7c3aed'),
  /** Absolute URL or path served by the developer's origin. */
  logo: z.string().max(2048).optional(),
  /** Display name shown in the modal. Defaults to the app name. */
  name: z.string().min(1).max(40).optional(),
});
export type Appearance = z.infer<typeof Appearance>;

export const ChainsConfig = z.object({
  evm: z.array(EvmChainId).default([8453]),
  solana: z.array(SolanaCluster).default([]),
});
export type ChainsConfig = z.infer<typeof ChainsConfig>;

/**
 * Full app configuration as stored in the `apps.config` JSON column and
 * as accepted by `<PocketkeyProvider config={...}>` on the client.
 * Client-side values are merged over the server config, never the reverse.
 */
export const AppConfig = z.object({
  loginMethods: z.array(LoginMethod).min(1).default(['email', 'google', 'passkey']),
  chains: ChainsConfig.default({ evm: [8453], solana: [] }),
  appearance: Appearance.default({ theme: 'system', accent: '#7c3aed' }),
  embeddedWallets: z
    .object({
      createOnLogin: CreateOnLogin.default('all'),
    })
    .default({ createOnLogin: 'all' }),
  gasSponsoring: z
    .object({
      evm: z.boolean().default(false),
      solana: z.boolean().default(false),
      /** Daily cap for the Solana fee payer, in lamports, as a decimal string. */
      solanaDailyCapLamports: z.string().regex(/^\d+$/).default('0'),
    })
    .default({ evm: false, solana: false, solanaDailyCapLamports: '0' }),
});
export type AppConfig = z.infer<typeof AppConfig>;
export type AppConfigInput = z.input<typeof AppConfig>;

/** Origin as `scheme://host[:port]`, no path. `*` is refused. */
export const AllowedOrigin = z
  .url()
  .refine((value) => {
    // Zod 4 keeps running checks after a failed one, so guard the parse.
    try {
      const url = new URL(value);
      return url.pathname === '/' && !url.search && !url.hash && url.username === '';
    } catch {
      return false;
    }
  }, 'Expected an origin without path, query or credentials')
  .transform((value) => new URL(value).origin);
export type AllowedOrigin = z.infer<typeof AllowedOrigin>;

export const AppSlug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, digits and hyphens only');

export const App = z.object({
  id: AppId,
  publicId: PublicAppId,
  developerId: DeveloperId,
  name: z.string().min(1).max(60),
  slug: AppSlug,
  allowedOrigins: z.array(AllowedOrigin),
  config: AppConfig,
  createdAt: z.iso.datetime(),
});
export type App = z.infer<typeof App>;

/** What `GET /v1/apps/:appId/config` returns. No secrets, cacheable at the edge. */
export const PublicAppConfig = z.object({
  appId: PublicAppId,
  name: z.string(),
  loginMethods: z.array(LoginMethod),
  chains: ChainsConfig,
  appearance: Appearance,
  embeddedWallets: z.object({ createOnLogin: CreateOnLogin }),
});
export type PublicAppConfig = z.infer<typeof PublicAppConfig>;

export const CreateAppInput = z.object({
  name: z.string().min(1).max(60),
  slug: AppSlug.optional(),
  allowedOrigins: z.array(AllowedOrigin).max(20).default([]),
  config: AppConfig.partial().optional(),
});
export type CreateAppInput = z.infer<typeof CreateAppInput>;

export const UpdateAppInput = CreateAppInput.partial();
export type UpdateAppInput = z.infer<typeof UpdateAppInput>;
