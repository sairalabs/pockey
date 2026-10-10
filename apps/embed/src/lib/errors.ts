import { isPockeyError, policyViolationReason } from '@pockey/core';
import type { EmbedError } from '@pockey/types';
import { isRecord } from './guards';

/**
 * What the embed sends as `response.error`. `reason` is the `details.reason` of a
 * `policy_violation` (session signers), part of `EmbedError` since 2026-09-17; hosts
 * that only read `{ code, message }` keep working.
 */
export type EmbedErrorPayload = EmbedError;

/** An error the embed reports to the host as `{ code, message }`. */
export class EmbedFailure extends Error {
  readonly code: string;
  readonly reason: string | undefined;

  constructor(code: string, message: string, reason?: string) {
    super(message);
    this.name = 'EmbedFailure';
    this.code = code;
    this.reason = reason;
  }
}

export function userRejected(message = 'The user rejected the request.'): EmbedFailure {
  return new EmbedFailure('user_rejected', message);
}

const withReason = (
  error: { code: string; message: string },
  reason: string | null | undefined,
): EmbedErrorPayload => (reason ? { ...error, reason } : error);

export function toEmbedError(error: unknown): EmbedErrorPayload {
  if (error instanceof EmbedFailure) {
    return withReason({ code: error.code, message: error.message }, error.reason);
  }
  if (isPockeyError(error)) {
    return withReason({ code: error.code, message: error.message }, policyViolationReason(error));
  }
  if (error instanceof Error) return { code: 'internal', message: error.message };
  if (isRecord(error) && typeof error.message === 'string') {
    return { code: 'internal', message: error.message };
  }
  return { code: 'internal', message: 'Unexpected error.' };
}

export function toFailure(error: unknown): EmbedFailure {
  if (error instanceof EmbedFailure) return error;
  const { code, message, reason } = toEmbedError(error);
  return new EmbedFailure(code, message, reason);
}
