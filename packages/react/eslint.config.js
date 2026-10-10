import { base } from '@pockey/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...base,
  reactHooks.configs.flat.recommended,
  { ignores: ['tsup.config.ts', 'vitest.config.ts', 'eslint.config.js', 'test/**'] },
];
