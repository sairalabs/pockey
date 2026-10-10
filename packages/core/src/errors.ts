import {
  ApiErrorBody,
  POLICY_VIOLATIONS,
  type ApiErrorCode,
  type PolicyViolation,
} from '@pockey/types';

/**
 * Stable error codes surfaced by the SDK: every documented API code plus the
 * failures that happen on the client side.
 */
export type PockeyErrorCode =
  | ApiErrorCode
  /** `fetch` rejected: offline, DNS, CORS preflight refused. The session is kept. */
  | 'network_error'
  /** The call needs a signed-in user and there is none (or the session was lost). */
  | 'not_authenticated'
  /** The user dismissed a passkey prompt or closed the OAuth popup. */
  | 'user_rejected'
  /** The browser refused to open the OAuth popup. Call from a click handler. */
  | 'popup_blocked'
  /** The runtime lacks a required capability (WebAuthn, window). */
  | 'unsupported'
  /** The API answered with a body that does not match the documented schema. */
  | 'invalid_response';

export interface PockeyErrorOptions {
  status?: number | undefined;
  requestId?: string | undefined;
  details?: unknown;
  cause?: unknown;
}

export class PockeyError extends Error {
  readonly code: PockeyErrorCode;
  /** HTTP status when the error comes from a response. */
  readonly status: number | undefined;
  /** API request id, quote it in support tickets. */
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(code: PockeyErrorCode, message: string, options: PockeyErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PockeyError';
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function isPockeyError(e: unknown): e is PockeyError {
  return e instanceof PockeyError;
}

/** Why a session policy refused a request: a stable policy reason, or the key provider denied it. */
export type SessionPolicyRefusal = PolicyViolation | 'provider_denied';

const REFUSALS: ReadonlySet<string> = new Set<string>([...POLICY_VIOLATIONS, 'provider_denied']);

function isRefusal(value: unknown): value is SessionPolicyRefusal {
  return typeof value === 'string' && REFUSALS.has(value);
}

/**
 * The `details.reason` of a `policy_violation` error, or null for any other error
 * (including a reason this SDK version does not know yet).
 */
export function policyViolationReason(error: unknown): SessionPolicyRefusal | null {
  if (!isPockeyError(error) || error.code !== 'policy_violation') return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  return isRefusal(details.reason) ? details.reason : null;
}

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal';
  return 'bad_request';
}

/** Turns a non-2xx response into a `PockeyError`, tolerating non JSON bodies (proxies, CDNs). */
export async function errorFromResponse(response: Response): Promise<PockeyError> {
  const headerRequestId = response.headers.get('X-Request-Id') ?? undefined;
  let data: unknown;
  try {
    data = JSON.parse(await response.text());
  } catch {
    data = undefined;
  }
  const parsed = ApiErrorBody.safeParse(data);
  if (parsed.success) {
    const { code, message, details, requestId } = parsed.data.error;
    return new PockeyError(code, message, {
      status: response.status,
      requestId: requestId ?? headerRequestId,
      details,
    });
  }
  return new PockeyError(
    codeFromStatus(response.status),
    `Request failed with status ${response.status}`,
    { status: response.status, requestId: headerRequestId },
  );
}
