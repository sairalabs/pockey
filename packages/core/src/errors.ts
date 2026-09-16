import { ApiErrorBody, type ApiErrorCode } from '@pocketkey/types';

/**
 * Stable error codes surfaced by the SDK: every documented API code plus the
 * failures that happen on the client side.
 */
export type PocketkeyErrorCode =
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

export interface PocketkeyErrorOptions {
  status?: number | undefined;
  requestId?: string | undefined;
  details?: unknown;
  cause?: unknown;
}

export class PocketkeyError extends Error {
  readonly code: PocketkeyErrorCode;
  /** HTTP status when the error comes from a response. */
  readonly status: number | undefined;
  /** API request id, quote it in support tickets. */
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(code: PocketkeyErrorCode, message: string, options: PocketkeyErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PocketkeyError';
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function isPocketkeyError(e: unknown): e is PocketkeyError {
  return e instanceof PocketkeyError;
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

/** Turns a non-2xx response into a `PocketkeyError`, tolerating non JSON bodies (proxies, CDNs). */
export async function errorFromResponse(response: Response): Promise<PocketkeyError> {
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
    return new PocketkeyError(code, message, {
      status: response.status,
      requestId: requestId ?? headerRequestId,
      details,
    });
  }
  return new PocketkeyError(
    codeFromStatus(response.status),
    `Request failed with status ${response.status}`,
    { status: response.status, requestId: headerRequestId },
  );
}
