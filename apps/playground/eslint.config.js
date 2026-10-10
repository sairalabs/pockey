import { base } from '@pockey/config/eslint';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: [
      'eslint.config.js',
      'next.config.ts',
      'postcss.config.mjs',
      'playwright.config.ts',
      'next-env.d.ts',
      '.next/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...nextCoreWebVitals,
  ...base,
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: { 'import/no-default-export': 'off' },
  },
];
