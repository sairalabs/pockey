import { ApiErrorBody } from '@pocketkey/types';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AppEnv } from '../src/context.js';
import { ApiError, handleError } from '../src/errors.js';
import { requestId } from '../src/middleware/request-id.js';

function harness() {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(requestId);
  app.get('/api-error', () => {
    throw new ApiError('policy_violation', 'Value exceeds maxValuePerTx', { limit: '10' });
  });
  app.get('/zod', () => {
    z.object({ n: z.number() }).parse({ n: 'x' });
    return new Response('unreachable');
  });
  app.get('/boom', () => {
    throw new Error('secret stack');
  });
  return app;
}

describe('unified error handling', () => {
  it('maps ApiError to its status and body', async () => {
    const res = await harness().request('/api-error', {}, env);
    expect(res.status).toBe(403);
    const body = ApiErrorBody.parse(await res.json());
    expect(body.error.code).toBe('policy_violation');
    expect(body.error.details).toEqual({ limit: '10' });
    expect(body.error.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('maps ZodError to validation_failed with issues', async () => {
    const res = await harness().request('/zod', {}, env);
    expect(res.status).toBe(400);
    const body = ApiErrorBody.parse(await res.json());
    expect(body.error.code).toBe('validation_failed');
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('hides unknown errors behind internal', async () => {
    const res = await harness().request('/boom', {}, env);
    expect(res.status).toBe(500);
    const body = ApiErrorBody.parse(await res.json());
    expect(body.error.code).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('secret stack');
  });
});
