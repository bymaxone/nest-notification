import type { Config } from 'jest'

/**
 * Jest configuration for the real-Redis end-to-end suite.
 *
 * Kept apart from `jest.e2e.config.ts` and `jest.coverage.config.ts`: these specs start a Redis
 * container through Docker, so they are not part of `pnpm test`, `pnpm test:e2e` or the
 * aggregated coverage run, and nothing here counts toward the coverage gate. Run with
 * `pnpm test:e2e:redis`.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/redis/**/*.redis-e2e-spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.stryker-tmp/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@bymax-one/nest-notification$': '<rootDir>/src/server/index.ts',
    '^@bymax-one/nest-notification/shared$': '<rootDir>/src/shared/index.ts',
    '^@bymax-one/nest-notification/testing$': '<rootDir>/src/testing/index.ts'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.e2e.json' }]
  },
  // Starting the container can take a while on a cold image pull.
  testTimeout: 60_000
}

export default config
