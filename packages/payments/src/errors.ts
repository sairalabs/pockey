export type PaymentsErrorCode =
  'invalid_signature' | 'stale_signature' | 'provider_error' | 'invalid_payload';

/** Every failure of this package. Messages never contain API keys or webhook secrets. */
export class PaymentsError extends Error {
  readonly code: PaymentsErrorCode;
  readonly status?: number;

  constructor(
    code: PaymentsErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PaymentsError';
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}
