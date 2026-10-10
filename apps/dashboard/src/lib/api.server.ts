import {
  AdminAppList,
  AdminEndUserList,
  AdminSession,
  AdminUsage,
  ApiKeyList,
  AuthProviders,
  BillingSummary,
  SponsorBalance,
  type AdminApp,
  type UsageRange,
} from '@pockey/types';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ZodType } from 'zod';
import { ApiError, isUnauthorized, parseResponse, toQuery, type QueryValue } from '@/lib/api';

/**
 * Server side half of the admin client. Same parsing and same `ApiError` as
 * `api.ts`, but the request carries the cookies of the incoming request instead
 * of going through the browser, so a server component can render with data
 * without a client round trip.
 */

/** Base URL of the API. Server only: the browser never sees this origin. */
export const API_URL = process.env.POCKEY_API_URL ?? 'http://localhost:8787';

async function cookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function serverFetch<T>(
  path: string,
  schema: ZodType<T>,
  query?: Record<string, QueryValue>,
): Promise<T> {
  const cookie = await cookieHeader();
  const response = await fetch(`${API_URL}/admin${path}${toQuery(query)}`, {
    headers: cookie ? { cookie, accept: 'application/json' } : { accept: 'application/json' },
    cache: 'no-store',
  }).catch((cause: unknown) => {
    throw new ApiError(
      'internal',
      `The Pockey API at ${API_URL} is unreachable`,
      502,
      cause instanceof Error ? cause.message : null,
    );
  });
  return parseResponse(response, schema);
}

/**
 * Runs a loader and reports "no session" instead of throwing, so a page can
 * render the login screen rather than an error boundary. Anything that is not a
 * 401 keeps bubbling up.
 */
export async function tryFetch<T>(
  load: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    if (isUnauthorized(error)) return { ok: false };
    throw error;
  }
}

export function fetchSession(): Promise<AdminSession> {
  return serverFetch('/session', AdminSession);
}

export async function fetchApps(): Promise<AdminApp[]> {
  return (await serverFetch('/apps', AdminAppList)).apps;
}

export function fetchApp(appId: string): Promise<AdminApp> {
  return serverFetch(`/apps/${appId}`, AdminAppList.shape.apps.element);
}

/**
 * One app for a page under `/apps/[id]`. An app of another developer answers 404
 * exactly like an unknown id, so both render the Next not found page.
 */
export async function loadApp(
  appId: string,
): Promise<{ ok: true; data: AdminApp } | { ok: false }> {
  try {
    return { ok: true, data: await fetchApp(appId) };
  } catch (error) {
    if (isUnauthorized(error)) return { ok: false };
    if (error instanceof ApiError && error.code === 'not_found') notFound();
    throw error;
  }
}

export function fetchApiKeys(appId: string): Promise<ApiKeyList> {
  return serverFetch(`/apps/${appId}/api-keys`, ApiKeyList);
}

export function fetchUsage(appId: string, range: UsageRange): Promise<AdminUsage> {
  return serverFetch(`/apps/${appId}/usage`, AdminUsage, { range });
}

export function fetchEndUsers(appId: string, limit = 25): Promise<AdminEndUserList> {
  return serverFetch(`/apps/${appId}/users`, AdminEndUserList, { limit });
}

export function fetchSponsorBalance(appId: string): Promise<SponsorBalance> {
  return serverFetch(`/apps/${appId}/sponsoring`, SponsorBalance);
}

export function fetchBilling(): Promise<BillingSummary> {
  return serverFetch('/billing', BillingSummary);
}

/**
 * GitHub sign-in is off unless the API holds both GitHub secrets, and nothing
 * on the API advertises it, so the dashboard asks: the social endpoint answers
 * 400 `bad_request` when it is not configured. The answer only depends on the
 * API configuration, so it is kept for the life of the process.
 */
let githubProbe: Promise<boolean> | null = null;

export function githubAvailable(): Promise<boolean> {
  githubProbe ??= loadProviders();
  return githubProbe;
}

/** The API says which developer logins it can serve; no button is offered that cannot work. */
async function loadProviders(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/admin/auth/providers`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    return AuthProviders.parse(await response.json()).github;
  } catch {
    // An unreachable API is not a reason to offer a button that cannot work.
    return false;
  }
}
