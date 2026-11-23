/**
 * @fileoverview Holds the real-process fixture to the one thing it depends on: that the bundler it
 * uses resolves in a plain node, which is what a strict install in CI gives it, and not only under
 * the resolver of the test runner.
 * @layer test
 */

import { spawnSync } from 'node:child_process'

import { BUILD_TOOL_PACKAGE } from './real-process.fixture'

describe('the real-process fixture', () => {
  it('should resolve the bundler from the build tool in a plain node, without the test runner', () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const { createRequire } = require('node:module')
         const esbuild = createRequire(${JSON.stringify(BUILD_TOOL_PACKAGE)})('esbuild')
         process.stdout.write(typeof esbuild.buildSync)`
      ],
      { encoding: 'utf8' }
    )

    expect(result.stdout).toBe('function')
  })
})
