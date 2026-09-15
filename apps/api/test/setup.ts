import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Each test file gets an isolated D1 with the schema applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
