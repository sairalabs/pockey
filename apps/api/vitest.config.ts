import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd (Miniflare) with an isolated D1 per test file.
export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, '../../packages/db/migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            MAILER: 'memory',
            API_BASE_URL: 'http://localhost:8787',
            EMBED_ORIGIN: 'http://localhost:5174',
            // Test-only values. Real secrets live in Wrangler secrets.
            BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
            GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
