import { base } from '@pocketkey/config/eslint';

export default [
  ...base,
  { ignores: ['eslint.config.js', 'vitest.config.ts'] },
  {
    // Guard rail from CLAUDE.md: the Turnkey SDK may only be imported inside src/turnkey/.
    files: ['src/**/*.ts'],
    ignores: ['src/turnkey/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@turnkey/*'], message: 'Turnkey stays inside src/turnkey/.' }] },
      ],
    },
  },
];
