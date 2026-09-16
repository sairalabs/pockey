/**
 * Error raised by every Pocketkey call that goes through the embed iframe.
 * `code` is one of the embed protocol codes (`user_rejected`, `not_ready`, ...)
 * or an API error code relayed by the embed.
 */
export class PocketkeyEmbedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PocketkeyEmbedError';
    this.code = code;
  }
}

/** EIP-1193 error. Codes follow EIP-1193 and EIP-1474. */
export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ProviderRpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export const isPocketkeyEmbedError = (error: unknown): error is PocketkeyEmbedError =>
  error instanceof PocketkeyEmbedError;
