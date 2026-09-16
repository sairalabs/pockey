import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { ApiError } from '../errors.js';

/**
 * zValidator with our error shape: failures become `validation_failed`
 * with the Zod issues in `details`, like every other API error.
 */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ApiError('validation_failed', 'Request validation failed', result.error.issues);
    }
  });
}
