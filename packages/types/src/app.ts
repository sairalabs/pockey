import { z } from 'zod';
import { DEFAULT_ACCENT } from './color.js';
import { EvmChainId, SolanaCluster } from './chains.js';
import { AppId, DeveloperId, PublicAppId } from './ids.js';
import { KeyProviderFacts } from './keys.js';

export const LoginMethod = z.enum(['email', 'google', 'apple', 'passkey', 'wallet']);
export type LoginMethod = z.infer<typeof LoginMethod>;

export const CreateOnLogin = z.enum(['all', 'evm', 'solana', 'off']);
export type CreateOnLogin = z.infer<typeof CreateOnLogin>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a 6-digit hex color');

export const Radius = z.enum(['sharp', 'soft', 'round', 'pill']);
export type Radius = z.infer<typeof Radius>;

/**
 * Colors a developer may override for one mode. Anything left out keeps the
 * Pockey value for that mode, so a palette can be as small as a single surface.
 */
export const Palette = z.object({
  /** The modal itself. */
  surface: HexColor.optional(),
  /** Rows, fields and other blocks on the modal. */
  surfaceAlt: HexColor.optional(),
  /** The same blocks under the pointer. */
  surfaceHover: HexColor.optional(),
  text: HexColor.optional(),
  textMuted: HexColor.optional(),
  textSubtle: HexColor.optional(),
  danger: HexColor.optional(),
  /** Behind the modal. */
  overlay: HexColor.optional(),
});
export type Palette = z.infer<typeof Palette>;

export const Appearance = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  accent: HexColor.default(DEFAULT_ACCENT),
  /** Absolute URL or path served by the developer's origin. */
  logo: z.string().max(2048).optional(),
  /** Display name shown in the modal. Defaults to the app name. */
  name: z.string().min(1).max(40).optional(),
  /** Corner scale, applied to the modal, the rows, the fields and the marks together. */
  radius: Radius.default('soft'),
  /** CSS font stack. The host loads the font; the modal only names it. */
  font: z.string().max(200).optional(),
  /** Per mode color overrides. */
  light: Palette.optional(),
  dark: Palette.optional(),
  /** How opaque the overlay behind the modal is. */
  overlayOpacity: z.number().min(0).max(1).optional(),
  /** Hides the lock line under the login screen. */
  hideBranding: z.boolean().default(false),
  /** One line of your own under the login screen, for terms or a warning. */
  disclaimer: z.string().max(200).optional(),
});
export type Appearance = z.infer<typeof Appearance>;

/** Every appearance field at its default, for a modal rendered before any config lands. */
export const DEFAULT_APPEARANCE: Appearance = Appearance.parse({});

export const ChainsConfig = z.object({
  evm: z.array(EvmChainId).default([8453]),
  solana: z.array(SolanaCluster).default([]),
});
export type ChainsConfig = z.infer<typeof ChainsConfig>;

/**
 * Full app configuration as stored in the `apps.config` JSON column and
 * as accepted by `<PockeyProvider config={...}>` on the client.
 * Client-side values are merged over the server config, never the reverse.
 */
export const AppConfig = z.object({
  loginMethods: z.array(LoginMethod).min(1).default(['email', 'google', 'passkey']),
  chains: ChainsConfig.default({ evm: [8453], solana: [] }),
  appearance: Appearance.default(() => Appearance.parse({})),
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
  /** Origins allowed to embed the iframe. Public by nature, the embed checks its parent against it. */
  allowedOrigins: z.array(z.string()),
  /** Public facts the iframe needs to build key provider requests. */
  keyProvider: KeyProviderFacts,
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
