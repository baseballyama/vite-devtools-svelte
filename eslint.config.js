import svelte from 'eslint-plugin-svelte'
// ESLint covers only `.svelte` components (markup, runes, accessibility):
// oxlint lints every other file and does not parse Svelte templates.
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      'e2e/compat/kit3/**',
      // Fixture components are inputs to analyzers and compiler tests.
      'packages/vite-devtools-svelte/test/**/fixtures/**',
      // oxlint covers scripts and modules (including `.svelte.ts`).
      '**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
  },
  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        parser: ts.parser,
        projectService: true,
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: {
      ...ts.configs.strictTypeChecked.at(-1)?.rules,
      // Truthiness checks and `() => void fn()` are idiomatic here.
      '@typescript-eslint/strict-boolean-expressions': 'off',
      // Same as oxlint: `!` marks a value the code guarantees.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'svelte/block-lang': ['error', { script: 'ts' }],
      'svelte/button-has-type': 'error',
      'svelte/no-at-html-tags': 'error',
      'svelte/no-target-blank': 'error',
      'svelte/no-unused-class-name': 'off',
      'svelte/no-useless-mustaches': 'error',
      'svelte/prefer-class-directive': 'error',
      'svelte/prefer-style-directive': 'error',
      'svelte/require-each-key': 'error',
      'svelte/no-reactive-reassign': 'error',
      'svelte/require-event-dispatcher-types': 'error',
      'svelte/valid-compile': 'error',
      'svelte/no-ignored-unsubscribe': 'error',
      'svelte/no-unused-svelte-ignore': 'error',
      'svelte/derived-has-same-inputs-outputs': 'error',
      'svelte/no-dom-manipulating': 'error',
      'svelte/require-store-reactive-access': 'error',
      'svelte/prefer-svelte-reactivity': 'error',
      'svelte/prefer-writable-derived': 'error',
      'svelte/no-unnecessary-state-wrap': 'error',
    },
  },
)
