import { defineConfig } from 'drizzle-kit';

// Migrations are generated here and applied by Wrangler
// (`wrangler d1 migrations apply`) from apps/api. No push, no studio at MVP.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
