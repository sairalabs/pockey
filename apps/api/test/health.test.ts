import { ApiErrorBody } from '@pockey/types';
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '../src/routes/health.js';
import { request } from './helpers.js';

describe('GET /health', () => {
  it('reports ok with a validated body and a request id header', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.db).toBe('ok');
    expect(body.keyProvider).toBe('mock');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('echoes a well-formed client request id', async () => {
    const res = await request('/health', { headers: { 'X-Request-Id': 'client-abc-123' } });
    expect(res.headers.get('X-Request-Id')).toBe('client-abc-123');
  });

  it('returns the unified error body for unknown routes', async () => {
    const res = await request('/nope');
    expect(res.status).toBe(404);
    const body = ApiErrorBody.parse(await res.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBe(res.headers.get('X-Request-Id'));
  });
});
