import { base } from '@pockey/config/eslint';

export default [...base, { ignores: ['tsup.config.ts', 'vitest.config.ts', 'eslint.config.js'] }];
