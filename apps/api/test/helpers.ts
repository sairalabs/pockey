import {
  apps,
  createDb,
  newId,
  newPublicAppId,
  seed,
  SEED,
  SEED_APP_CONFIG,
  type AppRow,
} from '@pockey/db';
import { MemoryMailer } from '@pockey/mailer';
import { AdminApp, AppConfig, type AuthResponse, type AppConfigInput } from '@pockey/types';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import { invalidateApp } from '../src/lib/apps.js';
import { getMailer } from '../src/lib/mailer.js';
import { Device } from './device.js';

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
  return { 'X-Pockey-App-Id': publicId, ...headers };
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

/**
 * Full email OTP login through the public routes, as the iframe does it (session
 * key, OTP encrypted to the key provider, signed sign-up or login).
 */
export async function loginWithEmail(
  email: string,
  options: { publicId?: string; origin?: string } = {},
): Promise<{ body: AuthResponse; device: Device }> {
  const device = await Device.loginWithEmail(email, options);
  return { body: device.auth, device };
}

export function bearer(token: string, publicId?: string): Record<string, string> {
  return withApp({ Authorization: `Bearer ${token}`, Origin: EMBED_ORIGIN }, publicId);
}

export { env, SEED };

/* Dashboard. Developer sessions are real cookies, no bridge header. */

export const DASHBOARD_ORIGIN = 'http://localhost:3800';

/** Turns `Set-Cookie` headers into a `Cookie` header, dropping cleared ones. */
export function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0] ?? '')
    .filter((pair) => {
      const index = pair.indexOf('=');
      return index > 0 && pair.slice(index + 1) !== '';
    })
    .join('; ');
}

export interface AdminInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** One `/admin/*` call with the developer session cookie and the dashboard origin. */
export function adminRequest(
  path: string,
  cookie: string,
  init: AdminInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: DASHBOARD_ORIGIN,
    ...init.headers,
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const options: RequestInit = { method: init.method ?? 'GET', headers };
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(init.body);
  }
  return request(path, options);
}

/** Full developer email OTP login. Returns the session cookie header. */
export async function loginAsDeveloper(email: string): Promise<string> {
  const send = await adminRequest('/admin/auth/email-otp/send-verification-otp', '', {
    method: 'POST',
    body: { email, type: 'sign-in' },
  });
  expect(send.status, await send.clone().text()).toBe(200);

  const signIn = await adminRequest('/admin/auth/sign-in/email-otp', '', {
    method: 'POST',
    body: { email, otp: otpFrom(email) },
  });
  expect(signIn.status, await signIn.clone().text()).toBe(200);

  const cookie = cookiesOf(signIn);
  expect(cookie).toMatch(/session_token=/);
  return cookie;
}

/** Creates an app through the dashboard API and returns its `AdminApp`. */
export async function createAdminApp(
  cookie: string,
  body: Record<string, unknown>,
): Promise<AdminApp> {
  const res = await adminRequest('/admin/apps', cookie, { method: 'POST', body });
  expect(res.status, await res.clone().text()).toBe(201);
  return AdminApp.parse(await res.json());
}
