import {
  apps,
  createDb,
  newId,
  newPublicAppId,
  seed,
  SEED,
  SEED_APP_CONFIG,
  type AppRow,
} from '@pocketkey/db';
import { MemoryMailer } from '@pocketkey/mailer';
import { AppConfig, AuthResponse, type AppConfigInput } from '@pocketkey/types';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import { AUTH_COOKIES_HEADER } from '../src/auth/cookie-bridge.js';
import { parseEnv } from '../src/env.js';
import { invalidateApp } from '../src/lib/apps.js';
import { getMailer } from '../src/lib/mailer.js';

export const app = createApp();
export const EMBED_ORIGIN = 'http://localhost:5174';

export const db = () => createDb(env.DB);

export async function seedDb(): Promise<void> {
  await seed(db());
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init, env);
}

export function withApp(
  headers: Record<string, string> = {},
  publicId: string = SEED.app.publicId,
): Record<string, string> {
  return { 'X-Pocketkey-App-Id': publicId, ...headers };
}

export function mailer(): MemoryMailer {
  const instance = getMailer(parseEnv(env));
  if (!(instance instanceof MemoryMailer)) throw new Error('Tests expect MAILER=memory');
  return instance;
}

export function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  publicId?: string,
): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: withApp(
      { 'Content-Type': 'application/json', Origin: EMBED_ORIGIN, ...headers },
      publicId,
    ),
    body: JSON.stringify(body),
  });
}

/** Creates an extra app for tenant isolation tests. */
export async function createTestApp(config: AppConfigInput = {}): Promise<AppRow> {
  const id = newId('app');
  const [row] = await db()
    .insert(apps)
    .values({
      id,
      publicId: newPublicAppId(),
      developerId: SEED.developer.id,
      name: 'Other app',
      slug: id.slice(4, 24),
      allowedOrigins: ['https://other.example'],
      config: AppConfig.parse(config),
    })
    .returning();
  if (!row) throw new Error('Could not create test app');
  return row;
}

export async function updateSeedConfig(patch: AppConfigInput): Promise<void> {
  await db()
    .update(apps)
    .set({ config: AppConfig.parse({ ...SEED_APP_CONFIG, ...patch }) })
    .where(eq(apps.id, SEED.app.id));
  await invalidateApp(SEED.app.publicId);
}

export const randomDevice = () => `dev_${crypto.randomUUID().replace(/-/g, '')}`;

export function otpFrom(email: string): string {
  const message = mailer().lastTo(email);
  const code = message ? /\b(\d{6})\b/.exec(message.subject)?.[1] : undefined;
  if (!code) throw new Error(`No OTP mail for ${email}`);
  return code;
}

/** Full email OTP login through the public routes. */
export async function loginWithEmail(
  email: string,
  options: { device?: string; publicId?: string; origin?: string } = {},
): Promise<{ body: AuthResponse; authCookies: string }> {
  const device = options.device ?? randomDevice();
  const extra = {
    'X-Pocketkey-Device': device,
    ...(options.origin ? { Origin: options.origin } : {}),
  };
  const send = await postJson(
    '/v1/auth/email-otp/send-verification-otp',
    { email, type: 'sign-in' },
    extra,
    options.publicId,
  );
  expect(send.status, await send.clone().text()).toBe(200);

  const signIn = await postJson(
    '/v1/auth/sign-in/email-otp',
    { email, otp: otpFrom(email) },
    extra,
    options.publicId,
  );
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  return {
    body: AuthResponse.parse(await signIn.json()),
    authCookies: signIn.headers.get(AUTH_COOKIES_HEADER) ?? '',
  };
}

export function bearer(token: string, publicId?: string): Record<string, string> {
  return withApp({ Authorization: `Bearer ${token}`, Origin: EMBED_ORIGIN }, publicId);
}

export { env, SEED };
