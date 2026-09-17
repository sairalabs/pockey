export type GasSponsorErrorCode =
  | 'fee_payer_misuse'
  | 'fee_too_high'
  | 'unsupported_transaction'
  | 'bundler_error'
  | 'price_unavailable'
  | 'invalid_input';

/** Every failure of this package surfaces as a `GasSponsorError` with a stable `code`. */
export class GasSponsorError extends Error {
  readonly code: GasSponsorErrorCode;
  readonly details?: unknown;

  constructor(
    code: GasSponsorErrorCode,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GasSponsorError';
    this.code = code;
    if (options?.details !== undefined) this.details = options.details;
  }
}
