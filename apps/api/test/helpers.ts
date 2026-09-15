import { createDb, seed, SEED } from '@pocketkey/db';
import { env } from 'cloudflare:workers';
import { createApp } from '../src/app.js';

export const app = createApp();

export async function seedDb(): Promise<void> {
  await seed(createDb(env.DB));
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init, env);
}

export function withApp(headers: Record<string, string> = {}): HeadersInit {
  return { 'X-Pocketkey-App-Id': SEED.app.publicId, ...headers };
}

export { env, SEED };
