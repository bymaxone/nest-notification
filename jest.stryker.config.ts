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
  testEnvironment: '@stryker-mutator/jest-runner/jest-env/node',
  testPathIgnorePatterns: [
    ...(base.testPathIgnorePatterns ?? []),
    // Reads the source text to find every throw site. Under Stryker the sandbox source is
    // instrumented, so the pattern it searches for is no longer there; it kills no mutant, and
    // `pnpm test` and CI still run it.
    '<rootDir>/server/errors/error-codes\\.readme\\.spec\\.ts$',
    // Runs a repository script on source snippets and touches no code in `src`, so it kills no
    // mutant; `pnpm test` and CI still run it.
    '<rootDir>/internal-members\\.spec\\.ts$',
    '<rootDir>/check-api-surface\\.spec\\.ts$',
    // Reads the README as text and compiles the entry points as files to compare their exports
    // with it; it imports nothing from `src` at run time, so it kills no mutant, and `pnpm test`
    // and CI still run it.
    '<rootDir>/readme-exports\\.spec\\.ts$',
    // These two import no module that is mutated, only the fixture under `__tests__`, which the
    // mutate list excludes, so the related-test lookup never selects them and they kill no mutant;
    // `pnpm test` and `pnpm test:cov` still run them.
    '<rootDir>/server/utils/realm-root\\.process\\.spec\\.ts$',
    '<rootDir>/server/__tests__/real-process\\.fixture\\.spec\\.ts$',
    // Reads every production file as text and parses it to hold each await to the pinned-await and
    // sealed-return rules; it imports no module from `src`, so the related-test lookup never selects
    // it and it kills no mutant. Under Stryker the sandbox source is instrumented, so the text it
    // checks is not the text it was written for; `pnpm test` and CI still run it.
    '<rootDir>/server/guard-family\\.scan\\.spec\\.ts$'
  ]
}

export default config
