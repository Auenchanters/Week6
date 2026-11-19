/** Strict typed linting, accessible JSX and hook rules are enforced for application code. */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig(
  {
    // Suppression comments are banned outright: they are ignored and reported if present.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '.vercel/**',
      'artifacts/**',
      'playwright-report/**',
      'test-results/**',
      'reports/**',
      '.stryker-tmp/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      jsxA11y.flatConfigs.strict,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Size and complexity gates for shipped code. A function past 10 paths, 15 statements, 80 lines,
    // 4 parameters, 3 levels of nesting or 3 nested callbacks gets split by responsibility (a React
    // component into named parts); a file past 250 lines of code gets divided. Tests are exempt: a
    // case table is long by design and reads top to bottom.
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'api/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      complexity: ['error', 10],
      'max-statements': ['error', 15],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-nested-callbacks': ['error', 3],
      'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Documentation coverage, enforced: every exported function, constant, interface and type in
    // shipped code carries a doc comment, so "every export is documented" is a gate, not a claim.
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'api/**/*.ts', 'scripts/**/*.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'VariableDeclaration'],
        },
      ],
      'jsdoc/check-alignment': 'error',
      'jsdoc/no-multi-asterisks': 'error',
    },
  },
  {
    // The strict preset allows no exceptions here. The WAI-ARIA tabs pattern makes each tabpanel
    // focusable (jsx-a11y's recommended preset allows that role too), and a scrollable <pre>
    // must be focusable so keyboard users can scroll it (axe: scrollable-region-focusable).
    files: ['src/**/*.tsx'],
    rules: {
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: ['pre'], roles: ['tabpanel'] }],
    },
  },
  {
    // No type assertions anywhere, tests included; `as const` stays allowed by this rule.
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    // The request log is the one place server code writes routine lines, at info level.
    files: ['server/log.ts'],
    rules: { 'no-console': ['error', { allow: ['info', 'warn', 'error'] }] },
  },
  {
    // The one plain Node script (it must load the emitted API as plain ESM); baseline rules only.
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { process: 'readonly', Request: 'readonly' } },
  },
);
