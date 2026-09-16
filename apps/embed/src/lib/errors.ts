import { isPocketkeyError } from '@pocketkey/core';
import type { EmbedError } from '@pocketkey/types';
import { isRecord } from './guards';

/** An error the embed reports to the host as `{ code, message }`. */
export class EmbedFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmbedFailure';
    this.code = code;
  }
}

export function userRejected(message = 'The user rejected the request.'): EmbedFailure {
  return new EmbedFailure('user_rejected', message);
}

export function toEmbedError(error: unknown): EmbedError {
  if (error instanceof EmbedFailure) return { code: error.code, message: error.message };
  if (isPocketkeyError(error)) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'internal', message: error.message };
  if (isRecord(error) && typeof error.message === 'string') {
    return { code: 'internal', message: error.message };
  }
  return { code: 'internal', message: 'Unexpected error.' };
}

export function toFailure(error: unknown): EmbedFailure {
  if (error instanceof EmbedFailure) return error;
  const { code, message } = toEmbedError(error);
  return new EmbedFailure(code, message);
}
