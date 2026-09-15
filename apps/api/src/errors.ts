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
