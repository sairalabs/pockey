import { HTTP_STATUS_BY_CODE, type ApiErrorBody, type ApiErrorCode } from '@pocketkey/types';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

/**
 * Throw this anywhere in a handler. `onError` turns it into the documented
 * `{ error: { code, message, details?, requestId } }` body (section 7.2, types/errors.ts).
 */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;

  constructor(
    readonly code: ApiErrorCode,
    message?: string,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message ?? defaultMessage(code), options);
    this.name = 'ApiError';
    this.status = HTTP_STATUS_BY_CODE[code] as ContentfulStatusCode;
  }
}

function defaultMessage(code: ApiErrorCode): string {
  return code.replace(/_/g, ' ');
}

/** What a 429 says about itself (T5.5). */
export interface RateLimitDetails {
  /** Scope of `RATE_LIMIT_DEFAULTS` that refused the request. */
  scope: string;
  limit: number;
  /** End of the current window, ISO 8601. */
  resetAt: string;
}

/**
 * 429 with a `Retry-After` header. A plain `ApiError` carries no header, and a
 * client needs one to back off instead of hammering the same second.
 */
export class RateLimitError extends ApiError {
  constructor(
    readonly retryAfterSeconds: number,
    details: RateLimitDetails,
  ) {
    super('rate_limited', `Too many requests, retry in ${retryAfterSeconds} seconds`, details);
    this.name = 'RateLimitError';
  }
}

export function errorBody(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ApiErrorBody {
  return {
    error:
      details === undefined ? { code, message, requestId } : { code, message, details, requestId },
  };
}

/** Hono `app.onError` handler. Never leaks stack traces or provider payloads. */
export function handleError(err: unknown, c: Context): Response {
  const requestId = c.get('requestId') as string | undefined;
  const rid = requestId ?? crypto.randomUUID();

  if (err instanceof RateLimitError) {
    return c.json(errorBody(err.code, err.message, rid, err.details), err.status, {
      'Retry-After': String(err.retryAfterSeconds),
    });
  }

  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message, rid, err.details), err.status);
  }

  if (err instanceof ZodError) {
    return c.json(
      errorBody('validation_failed', 'Request validation failed', rid, err.issues),
      400,
    );
  }

  if (err instanceof HTTPException) {
    const code: ApiErrorCode =
      err.status === 401
        ? 'unauthorized'
        : err.status === 403
          ? 'forbidden'
          : err.status === 404
            ? 'not_found'
            : 'bad_request';
    return c.json(errorBody(code, err.message, rid), err.status);
  }

  console.error(`[${rid}] unhandled`, err);
  return c.json(errorBody('internal', 'Internal error', rid), 500);
}
