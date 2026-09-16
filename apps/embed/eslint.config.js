import { base } from '@pocketkey/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['eslint.config.js', 'dist/**'] },
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
];
