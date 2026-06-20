import type { Config } from 'jest'

/**
 * Unit-test Jest configuration.
 *
 * Discovers `*.spec.ts` next to the source under `src/` and enforces 100%
 * line/branch coverage over every implemented file (the `index.ts` barrels and
 * pure-type declaration files carry no executable statements and are excluded).
 *
 * React hooks (the `./react` subpath) are browser code: their specs opt into the
 * jsdom environment per file with a `@jest-environment jsdom` docblock, so the
 * default Node environment stays fast for the server/shared suites.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  coverageDirectory: '<rootDir>/../coverage',
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // Mirror the subpath aliases declared in tsconfig.json "paths" so tests
  // exercise the exact import specifiers consumers and the tsup bundler use.
  moduleNameMapper: {
    '^@bymax-one/nest-notification$': '<rootDir>/server/index.ts',
    '^@bymax-one/nest-notification/shared$': '<rootDir>/shared/index.ts',
    '^@bymax-one/nest-notification/react$': '<rootDir>/react/index.ts'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../tsconfig.jest.json'
      }
    ]
  },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.test.ts',
    '!**/__tests__/**',
    '!**/index.ts',
    '!**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  coverageReporters: ['text', 'lcov', 'clover'],
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true
}

export default config
