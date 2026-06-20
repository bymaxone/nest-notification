import type { Config } from 'jest'

/**
 * Jest configuration for end-to-end tests.
 *
 * Lives separately from the unit-test config (`jest.config.ts`) so the unit-suite
 * coverage thresholds never interfere with E2E runs, and so E2E specs can be
 * discovered under `test/e2e/` rather than inside `src/`. The config roots at the
 * project so a still-absent `test/e2e/` directory does not error; `passWithNoTests`
 * keeps it green until the first `*.e2e-spec.ts` is added.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  // rootDir '.' would otherwise scan build output and Stryker sandboxes, whose
  // duplicate copies of `src/` crash jest-haste-map on this package's alias.
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.stryker-tmp/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@bymax-one/nest-notification$': '<rootDir>/src/server/index.ts',
    '^@bymax-one/nest-notification/shared$': '<rootDir>/src/shared/index.ts',
    '^@bymax-one/nest-notification/react$': '<rootDir>/src/react/index.ts'
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.e2e.json'
      }
    ]
  },
  testTimeout: 30_000,
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true
}

export default config
