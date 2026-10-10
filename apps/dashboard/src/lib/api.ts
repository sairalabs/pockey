import {
  AdminAppList,
  AdminEndUserList,
  AdminSession,
  AdminUsage,
  ApiErrorBody,
  ApiKeyList,
  BillingPortalOutput,
  BillingSummary,
  CreateApiKeyOutput,
  SponsorBalance,
  TopUpCheckoutOutput,
  type AdminApp,
  type ApiErrorCode,
  type AppConfig,
  type CreateAppInput,
  type UpdateAppInput,
  type UsageRange,
} from '@pockey/types';
import { z, type ZodType } from 'zod';

/**
 * Typed client for the admin API (T5.1 to T5.4).
 *
 * The browser only ever talks to the dashboard origin: every call goes to the
 * Next route handler of `app/api/admin/[...path]`, which forwards method, body,
 * query and cookies to `${POCKEY_API_URL}/admin/...` and hands `Set-Cookie`
 * back. No CORS, no third party cookie. Server components use the same parsing
 * through `api.server.ts`, which reads the cookies of the incoming request.
 */

/** Path prefix of the proxy route handler. */
export const ADMIN_PROXY_PREFIX = '/api/admin';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details: unknown = null,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

/** True for the one error the whole dashboard treats as "show the login screen". */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthorized';
}

const IssueList = z.array(
  z.object({
    path: z.array(z.union([z.string(), z.number()])).optional(),
    message: z.string(),
  }),
);

/** `config.loginMethods: Too small` out of the `details` of a 400. */
export function errorDetail(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const issues = IssueList.safeParse(error.details);
  if (!issues.success || issues.data.length === 0) return null;
  return issues.data
    .map((issue) => `${(issue.path ?? []).join('.') || 'input'}: ${issue.message}`)
    .join('; ');
}

/** Message of any thrown value, for inline error text next to a form. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) {
    const detail = errorDetail(error);
    return detail === null ? error.message : `${error.message} (${detail})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

async function toApiError(response: Response): Promise<ApiError> {
  const raw: unknown = await response.json().catch(() => null);
  const parsed = ApiErrorBody.safeParse(raw);
  if (parsed.success) {
    const { code, message, details, requestId } = parsed.data.error;
    return new ApiError(code, message, response.status, details ?? null, requestId ?? null);
  }
  return new ApiError(
    response.status === 401 ? 'unauthorized' : 'internal',
    `The API answered ${response.status}`,
    response.status,
  );
}

/** Throws a typed `ApiError` on any non-2xx, then validates the body. */
export async function parseResponse<T>(response: Response, schema: ZodType<T>): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  const raw: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      'internal',
      'The API answered with an unexpected shape',
      response.status,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export type QueryValue = string | number | undefined;

export function toQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

export interface AdminRequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
}

/** Browser side call, through the proxy. `path` starts with a slash, no `/admin`. */
export async function adminFetch<T>(
  path: string,
  schema: ZodType<T>,
  init: AdminRequestInit = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const response = await fetch(`${ADMIN_PROXY_PREFIX}${path}${toQuery(init.query)}`, {
    method: init.method ?? 'GET',
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(init.body) : null,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  return parseResponse(response, schema);
}

export const OkOutput = z.object({ ok: z.literal(true) });

/* ---------- Authentication (Better Auth, allowlisted on the API) ---------- */

/** Better Auth answers `{ success: true }`; only the status matters here. */
const AuthAck = z.unknown();
const SocialSignIn = z.object({ url: z.url() });

export async function sendLoginCode(email: string): Promise<void> {
  await adminFetch('/auth/email-otp/send-verification-otp', AuthAck, {
    method: 'POST',
    body: { email, type: 'sign-in' },
  });
}

export async function verifyLoginCode(email: string, otp: string): Promise<void> {
  await adminFetch('/auth/sign-in/email-otp', AuthAck, { method: 'POST', body: { email, otp } });
}

/** Returns the GitHub authorize URL to send the browser to. */
export async function startGithubSignIn(callbackURL: string): Promise<string> {
  const { url } = await adminFetch('/auth/sign-in/social', SocialSignIn, {
    method: 'POST',
    body: { provider: 'github', callbackURL },
  });
  return url;
}

export async function signOut(): Promise<void> {
  await adminFetch('/auth/sign-out', AuthAck, { method: 'POST', body: {} });
}

export function getSession(): Promise<z.infer<typeof AdminSession>> {
  return adminFetch('/session', AdminSession);
}

/* ---------- Apps ---------- */

const AdminAppOutput = AdminAppList.shape.apps.element;

export function listApps(): Promise<z.infer<typeof AdminAppList>> {
  return adminFetch('/apps', AdminAppList);
}

export function createApp(input: CreateAppInput): Promise<AdminApp> {
  return adminFetch('/apps', AdminAppOutput, { method: 'POST', body: input });
}

export function updateApp(appId: string, input: UpdateAppInput): Promise<AdminApp> {
  return adminFetch(`/apps/${appId}`, AdminAppOutput, { method: 'PATCH', body: input });
}

export function saveAppConfig(appId: string, config: AppConfig): Promise<AdminApp> {
  return adminFetch(`/apps/${appId}/config`, AdminAppOutput, { method: 'PUT', body: { config } });
}

/* ---------- API keys ---------- */

export function listApiKeys(appId: string): Promise<z.infer<typeof ApiKeyList>> {
  return adminFetch(`/apps/${appId}/api-keys`, ApiKeyList);
}

export function createApiKey(
  appId: string,
  name: string | undefined,
): Promise<z.infer<typeof CreateApiKeyOutput>> {
  return adminFetch(`/apps/${appId}/api-keys`, CreateApiKeyOutput, {
    method: 'POST',
    body: name === undefined ? {} : { name },
  });
}

export async function revokeApiKey(appId: string, keyId: string): Promise<void> {
  await adminFetch(`/apps/${appId}/api-keys/${keyId}`, OkOutput, { method: 'DELETE' });
}

/* ---------- Usage, users, sponsoring, billing ---------- */

export function getUsage(appId: string, range: UsageRange): Promise<z.infer<typeof AdminUsage>> {
  return adminFetch(`/apps/${appId}/usage`, AdminUsage, { query: { range } });
}

export function listEndUsers(
  appId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<z.infer<typeof AdminEndUserList>> {
  return adminFetch(`/apps/${appId}/users`, AdminEndUserList, {
    query: { cursor: options.cursor, limit: options.limit },
  });
}

export function getSponsorBalance(appId: string): Promise<z.infer<typeof SponsorBalance>> {
  return adminFetch(`/apps/${appId}/sponsoring`, SponsorBalance);
}

export function createTopUpCheckout(
  appId: string,
  input: { amountCents: number; successUrl: string; cancelUrl: string },
): Promise<z.infer<typeof TopUpCheckoutOutput>> {
  return adminFetch(`/apps/${appId}/sponsoring/checkout`, TopUpCheckoutOutput, {
    method: 'POST',
    body: input,
  });
}

export function getBilling(): Promise<z.infer<typeof BillingSummary>> {
  return adminFetch('/billing', BillingSummary);
}

export function getBillingPortal(returnUrl: string): Promise<z.infer<typeof BillingPortalOutput>> {
  return adminFetch('/billing/portal', BillingPortalOutput, { query: { returnUrl } });
}
