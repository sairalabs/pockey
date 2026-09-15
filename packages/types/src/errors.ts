import { z } from 'zod';

/**
 * Every non-2xx response from the API has this exact shape.
 * `code` is stable and documented, `message` is for humans and may change.
 */
export const ApiErrorCode = z.enum([
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'app_id_missing',
  'app_id_invalid',
  'origin_not_allowed',
  'api_key_invalid',
  'session_expired',
  'policy_violation',
  'insufficient_sponsor_balance',
  'key_provider_error',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    /** Zod issues or provider details. Never contains secrets. */
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const HTTP_STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  app_id_missing: 400,
  app_id_invalid: 401,
  origin_not_allowed: 403,
  api_key_invalid: 401,
  session_expired: 401,
  policy_violation: 403,
  insufficient_sponsor_balance: 402,
  key_provider_error: 502,
  internal: 500,
};
