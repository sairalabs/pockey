import { base } from '@pockey/config/eslint';

export default [
  ...base,
  { ignores: ['eslint.config.js', 'vitest.config.ts', 'drizzle.config.ts', 'migrations/**'] },
];
