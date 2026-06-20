import type { Config } from 'jest'

// Explicit `.ts` extension: Stryker runs under Node 24, whose native TS
// type-stripping loads this config as ESM, and ESM relative imports require the
// file extension.
import base from './jest.config.ts'

/**
 * Stryker-only Jest configuration.
 *
 * Wraps the base unit-test config with Stryker's instrumented Node test
 * environment so `coverageAnalysis: "perTest"` can map every mutant to the exact
 * tests covering it. The base config stays untouched (plain `'node'`) so a normal
 * `pnpm test` never depends on the mutation toolchain.
 */
const config: Config = {
  ...base,
  testEnvironment: '@stryker-mutator/jest-runner/jest-env/node'
}

export default config
