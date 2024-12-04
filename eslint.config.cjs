const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');

module.exports = [
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        self: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLAnchorElement: 'readonly',
        MutationObserver: 'readonly',
        Element: 'readonly',
        NodeList: 'readonly',
        NodeListOf: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.strict.rules,
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
          ignoreIIFE: true,
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'off',
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-return-await': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'prefer-promise-reject-errors': 'error',
      'require-atomic-updates': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'Use chrome.storage.local instead',
        },
        {
          object: 'window',
          property: 'sessionStorage',
          message: 'Use chrome.storage.session instead',
        },
        {
          object: 'window',
          property: 'indexedDB',
          message: 'Use chrome.storage.local for persistent storage',
        },
        {
          object: 'document',
          property: 'cookie',
          message: 'Use chrome.storage for data persistence',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'webextension-polyfill',
              message: 'Use chrome.* APIs directly for better type safety',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'setInterval',
          message: 'Use chrome.alarms API instead for better battery life and reliability in background contexts',
        },
      ],
      'no-script-url': 'error',
      'no-proto': 'error',
      'no-extend-native': 'error',
      'no-iterator': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    ...prettier,
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        console: true,
        __dirname: true,
        process: true,
        require: true,
        module: true,
        Buffer: true,
      },
    },
  },
  {
    files: ['webpack.config.cjs'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/background.ts'],
    languageOptions: {
      globals: {
        self: true,
        ServiceWorkerGlobalScope: true,
        chrome: true
      }
    }
  },
];
