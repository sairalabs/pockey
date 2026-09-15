import { base } from '@pocketkey/config/eslint';

export default [
  ...base,
  { ignores: ['eslint.config.js', 'vitest.config.ts', 'worker-configuration.d.ts'] },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@turnkey/*'],
              message: 'Turnkey stays inside packages/key-provider/src/turnkey/.',
            },
            { group: ['drizzle-orm/d1'], message: 'Use createDb() from @pocketkey/db.' },
          ],
        },
      ],
    },
  },
];
