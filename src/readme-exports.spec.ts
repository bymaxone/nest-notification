/**
 * @fileoverview Holds the README to naming every public export of every subpath: a reader of the
 * package page can find each runtime value, each type and each constant by name. The names are
 * read from the entry points through the compiler, so an export added to an `index.ts` without a
 * mention in the README fails here and not in a review.
 * @layer docs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'

const ROOT = join(__dirname, '..')
const SUBPATHS = ['server', 'shared', 'react', 'testing', 'observability'] as const

/** The names an entry point exports, types included, as the compiler resolves them. */
function exportsOf(subpath: string): string[] {
  const entry = join(ROOT, 'src', subpath, 'index.ts')
  const config = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  const program = ts.createProgram([entry], parsed.options)
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source)
  return symbol === undefined ? [] : checker.getExportsOfModule(symbol).map((item) => item.name)
}

/** Whether the README names `name` as a whole word, not as part of a longer identifier. */
function named(readme: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/\$/g, '\\$')}($|[^A-Za-z0-9_$])`).test(
    readme
  )
}

describe('README public exports', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

  describe.each(SUBPATHS)('the %s entry point', (subpath) => {
    const names = exportsOf(subpath)

    it('should export something, so an unreadable entry cannot pass vacuously', () => {
      expect(names.length).toBeGreaterThan(0)
    })

    it('should be named in full in the README', () => {
      expect(names.filter((name) => !named(readme, name))).toEqual([])
    })
  })
})
