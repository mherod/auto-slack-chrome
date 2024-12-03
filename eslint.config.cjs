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
        document: 'readonly',
        window: 'readonly',
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
      '@typescript-eslint/strict-boolean-expressions': 'error',
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
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      'no-restricted-globals': [
        'error',
        'event',
        'fdescribe',
        {
          name: 'fetch',
          message: 'Use chrome.runtime.sendMessage for cross-origin requests'
        },
        {
          name: 'history',
          message: 'Use chrome.history API instead'
        },
        {
          name: 'location',
          message: 'Use chrome.tabs API for navigation'
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="window"][callee.property.name="open"]',
          message: 'Use chrome.windows.create instead of window.open'
        },
        {
          selector: 'CallExpression[callee.object.name="window"][callee.property.name="close"]',
          message: 'Use chrome.windows.remove instead of window.close'
        },
        {
          selector: 'CallExpression[callee.name="eval"]',
          message: 'eval() is dangerous and violates Chrome extension CSP'
        },
        {
          selector: 'CallExpression[callee.name="Function"]',
          message: 'new Function() is dangerous and violates Chrome extension CSP'
        }
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'no-console': 'error',
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
];
