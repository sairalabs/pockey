import { base } from '@pockey/config/eslint';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: [
      'eslint.config.js',
      'next.config.ts',
      'postcss.config.mjs',
      'next-env.d.ts',
      '.next/**',
      'out/**',
    ],
  },
  // Next's flat config first so the shared, stricter typescript-eslint setup
  // (type-aware, projectService) wins for TypeScript files.
  ...nextCoreWebVitals,
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Next's App Router uses default exports for pages, layouts and configs.
      'import/no-default-export': 'off',
    },
  },
];
