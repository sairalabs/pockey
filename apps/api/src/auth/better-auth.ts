import { passkey } from '@better-auth/passkey';
import { authSchema, type AppRow, type Db } from '@pocketkey/db';
import { otpEmail, type Mailer } from '@pocketkey/mailer';
import { AppConfig } from '@pocketkey/types';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import type { ParsedEnv } from '../env.js';
import { scopeAdapter } from './tenant-adapter.js';

/** Section 8.1: 6 digits, 10 minutes, 5 attempts. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_ATTEMPTS = 5;
/** Better Auth sessions only bridge to Pocketkey tokens and passkey enrollment. */
export const AUTH_SESSION_TTL_SECONDS = 60 * 60;

export interface EndUserAuthInput {
  db: Db;
  app: AppRow;
  config: ParsedEnv;
  mailer: Mailer;
  /** Hashed device id, binds OTP codes to the requesting browser. */
  deviceBinding?: string | undefined;
}

/**
 * One Better Auth instance per request, scoped to a single app (T1.1).
 * Construction is cheap (no I/O), and per-request scoping is what makes the
 * tenant adapter and the device binding possible without global state.
 */
export function createEndUserAuth(input: EndUserAuthInput) {
  const { app, config, mailer } = input;
  const appConfig = AppConfig.parse(app.config);
  const methods = new Set(appConfig.loginMethods);
  const embed = new URL(config.EMBED_ORIGIN);

  const google =
    methods.has('google') && config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? {
          clientId: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          prompt: 'select_account' as const,
        }
      : undefined;
  const apple =
    methods.has('apple') && config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET
      ? {
          clientId: config.APPLE_CLIENT_ID,
          clientSecret: config.APPLE_CLIENT_SECRET,
          ...(config.APPLE_APP_BUNDLE_IDENTIFIER
            ? { appBundleIdentifier: config.APPLE_APP_BUNDLE_IDENTIFIER }
            : {}),
        }
      : undefined;

  return betterAuth({
    appName: appConfig.appearance.name ?? app.name,
    baseURL: config.API_BASE_URL,
    basePath: '/v1/auth',
    secret: config.BETTER_AUTH_SECRET,
    database: scopeAdapter(drizzleAdapter(input.db, { provider: 'sqlite', schema: authSchema }), {
      appId: app.id,
      ...(input.deviceBinding ? { verificationBinding: input.deviceBinding } : {}),
    }),
    user: {
      additionalFields: {
        appId: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: AUTH_SESSION_TTL_SECONDS,
      cookieCache: { enabled: false },
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ['google', 'apple', 'email-otp'] },
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(google ? { google } : {}),
      ...(apple ? { apple } : {}),
    },
    trustedOrigins: [
      config.EMBED_ORIGIN,
      new URL(config.API_BASE_URL).origin,
      ...app.allowedOrigins,
    ],
    // Rate limiting is T5.5 (per app and per end user, KV or Durable Objects).
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: 'pocketkey',
      // The iframe is third party on the host page; cookies only work cross-site with None.
      defaultCookieAttributes: { sameSite: 'none', secure: true },
    },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_TTL_SECONDS,
        allowedAttempts: OTP_ATTEMPTS,
        storeOTP: 'hashed',
        sendVerificationOTP: async ({ email, otp }) => {
          await mailer.send(
            otpEmail({
              to: email,
              code: otp,
              appName: appConfig.appearance.name ?? app.name,
              minutes: OTP_TTL_SECONDS / 60,
            }),
          );
        },
      }),
      passkey({
        rpID: embed.hostname,
        rpName: appConfig.appearance.name ?? app.name,
        origin: config.EMBED_ORIGIN,
      }),
    ],
  });
}

export type EndUserAuth = ReturnType<typeof createEndUserAuth>;
