import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,

  // Node runtime globals (console, process, etc.) for all files.
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Type-checked rules for our TypeScript sources (and TS config files).
  {
    files: ['src/**/*.ts', 'features/**/*.ts', '*.config.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // Layer boundaries (DDD): dependencies point inward only.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@temporalio/*'],
              message: 'domain must stay framework-free (no Temporal imports).',
            },
            {
              group: ['**/application/**', '**/infra/**', '**/interfaces/**'],
              message: 'domain must not depend on outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infra/**', '**/interfaces/**'],
              message: 'application depends on ports, not infra/interfaces adapters.',
            },
          ],
        },
      ],
    },
  },

  prettier,
);
