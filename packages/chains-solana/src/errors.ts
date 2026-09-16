/** Raised on malformed, unsupported or unsignable Solana payloads, and on RPC failures. */
export class SolanaTransactionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SolanaTransactionError';
  }
}
