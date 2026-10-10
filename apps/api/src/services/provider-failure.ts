import { KeyProviderError } from '@pockey/key-provider';
import { ApiError } from '../errors.js';

/** Maps key provider failures to a stable API error. Other errors pass through. */
export function providerFailure(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof KeyProviderError) {
    // Provider messages can describe internals; keep the code, not the text.
    throw new ApiError('key_provider_error', 'Key provider rejected the request', {
      reason: error.code,
    });
  }
  throw error;
}
