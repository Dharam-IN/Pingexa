import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Generated Prisma client, build output and tool caches are not our source.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/api/src/generated/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      'packages/*/dist/**',
      // Local, uncommitted review artefacts: the screenshot harness and its
      // output. Not shipped, not part of the product source.
      '.review/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // The SSRF guard must never be loosened from configuration. Tests
          // construct their own guard; production code uses `strictUrlGuard`.
          selector:
            "Property[key.name='allowPrivateAddresses'] > MemberExpression[object.name='env']",
          message: 'The SSRF guard must not be configurable from the environment.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    // Plain-JavaScript repository tooling: `scripts/*.mjs`. These are run
    // directly by Node (not compiled, not bundled), so they need the Node
    // globals that the TypeScript blocks above declare for their own files,
    // and they report to the terminal on purpose.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Scripts and tests print to stdout on purpose.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/tests/**/*.ts',
      '**/e2e/**/*.ts',
      'apps/api/src/scripts/**/*.ts',
      '*.config.ts',
      '*.config.mjs',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
