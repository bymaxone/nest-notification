/**
 * @fileoverview Runs library code in a real child process, for the specs that need a realm they
 * cannot make in a test worker: one started with `--disable-proto=delete`, one whose root prototype
 * is frozen, one where a thrown error would end the process. The source is bundled by esbuild into
 * a file under the system temporary directory, with `node_modules` left external.
 * @layer test
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

/**
 * esbuild is not a dependency of this package; the build tool it already depends on brings it, and
 * only that tool's own folder can resolve it under a strict install.
 */
const esbuild = createRequire(join(ROOT, 'node_modules/tsup/package.json'))('esbuild') as {
  buildSync(options: Record<string, unknown>): unknown
}

/** What a child process did. */
export interface ChildResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** A bundled entry and the directory that holds it. */
export interface Bundle {
  readonly file: string
  remove(): void
}

/**
 * Bundles a source file of the library into one CommonJS file.
 *
 * @param entry - A path relative to the repository root.
 * @returns The bundle, with a function that deletes it.
 */
export function bundle(entry: string): Bundle {
  const directory = mkdtempSync(join(tmpdir(), 'real-process-'))
  const file = join(directory, 'entry.cjs')
  esbuild.buildSync({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'error',
    outfile: file,
    absWorkingDir: ROOT
  })
  return { file, remove: () => rmSync(directory, { recursive: true, force: true }) }
}

/**
 * Runs a script in a fresh node, with the bundle as `lib` and `node_modules` resolvable.
 *
 * @param lib - The bundle the script loads.
 * @param script - Code that may use `lib`, the module's exports.
 * @param flags - Flags for node, such as `--disable-proto=delete`.
 * @returns What the process did.
 */
export function runNode(lib: Bundle, script: string, flags: readonly string[] = []): ChildResult {
  const result = spawnSync(
    process.execPath,
    [...flags, '-e', `const lib = require(${JSON.stringify(lib.file)});\n${script}`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: join(ROOT, 'node_modules') },
      timeout: 30_000
    }
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
