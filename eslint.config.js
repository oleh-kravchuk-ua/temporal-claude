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
    files: ['src/**/*.ts', 'features/**/*.ts', '*.config.ts', '*.setup.ts'],
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
      // Prefer arrow function expressions over `function` declarations.
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
    },
  },

  // Layer boundaries: the workflow depends on the port (ports.ts), never on an adapter.
  {
    files: ['src/workflow/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infra/**', '**/activities/**', '**/http/**', '**/cli/**'],
              message:
                'workflow must not depend on adapters — depend on the port (AiToolsActivities) instead.',
            },
          ],
        },
      ],
    },
  },

  // Activities are async by contract (the port returns Promises), so a mock/adapter body
  // with no `await` is intentional — real implementations will await I/O (e.g. an LLM call).
  {
    files: ['src/activities/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },

  prettier,
);
