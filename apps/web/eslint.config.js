// @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  {
    ignores: [
      '**/*.config.js',
      '**/*.config.ts',
      'eslint.config.js',
      'node_modules',
      'dist',
    ],
  },
  ...tanstackConfig,
]
