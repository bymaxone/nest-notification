/**
 * @fileoverview Mutates `as const` value tables one entry at a time and reports the mutants a test
 * command does not kill.
 * @layer scripts
 *
 * Mutation testing tools such as Stryker change operators and literals, but they neither remove a
 * property or an element from a constant table nor change a number in it. An entry can therefore
 * disappear, or a number drift, with every test green. This script fills that gap for a
 * development check:
 *
 * - it finds every object or array literal marked `as const` (alone or followed by `satisfies`)
 *   in the tracked source files under the source directory, ignoring specs, tests, declaration
 *   files and `index.ts`;
 * - for each entry it makes one mutant that removes the entry, and, when the entry is a number,
 *   one that adds one to it;
 * - for each mutant it runs the given test command and counts the mutant as killed when the
 *   command fails, or as a survivor when it passes;
 * - it prints the survivors and exits 1 when there are any.
 *
 * The unmutated tree must pass the command first, or the run stops with exit 2, because a failing
 * command would "kill" every mutant. The source file is restored after every mutant, and on
 * SIGINT or SIGTERM. Run it on a clean working tree.
 *
 * Make the command fail on a failed assertion only. A test runner that also type-checks counts a
 * removed property that other code reads as killed, which Stryker would not; turn the type check
 * off for this run (for ts-jest, `diagnostics: false`).
 *
 * Plain Node with no dependencies of its own: it loads `typescript` from the repository it runs
 * in, which any TypeScript project already has. Copy this file as it is.
 *
 * Usage: node scripts/mutate-const-tables.mjs [--root <dir>] [--src <dir>] [--only <text>] -- <command> [args...]
 *   --root  repository root (default: the current directory)
 *   --src   directory, relative to the root, whose files are mutated (default: src)
 *   --only  mutate only the files whose path contains this text (default: all)
 *   command the test command, run without a shell from the root. The text `{file}` in an
 *           argument is replaced by the mutated file's path relative to the root, and the
 *           environment variable MUTATED_FILE holds the same path.
 *
 * Example: node scripts/mutate-const-tables.mjs --only default-ttls -- pnpm exec jest \
 *   --config jest.mutants.config.ts --findRelatedTests {file} --coverage=false --silent
 *
 * Exit codes: 0 every mutant was killed (or there is no table), 1 at least one survived, 2 usage
 * error or a failing baseline.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

/** Files that are never mutated: specs, tests, declaration files and barrels. */
const SKIPPED_FILE = /(?:\.(?:spec|test)\.[cm]?[jt]sx?|\.d\.[cm]?ts|(?:^|\/)index\.[cm]?[jt]sx?)$/

/** Source files that can hold a table. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/

/** Exit code for a usage error or a failing baseline. */
const EXIT_USAGE = 2

/** Reads `--name value` from the options, or returns the fallback. */
function option(options, name, fallback) {
  const index = options.indexOf(name)
  return index === -1 ? fallback : (options[index + 1] ?? fallback)
}

/** Splits the arguments at the first `--` into the options and the test command. */
function parseArguments(argv) {
  const split = argv.indexOf('--')
  const options = split === -1 ? argv : argv.slice(0, split)
  const command = split === -1 ? [] : argv.slice(split + 1)
  return {
    root: resolve(option(options, '--root', process.cwd())),
    src: option(options, '--src', 'src'),
    only: option(options, '--only', ''),
    command
  }
}

/** Loads the `typescript` package of the repository at the root. */
function loadTypeScript(root) {
  return createRequire(join(root, 'package.json'))('typescript')
}

/** Paths, relative to the root, of the tracked files that may hold a table. */
function candidateFiles(root, src, only) {
  const listing = execFileSync('git', ['ls-files', '-z', '--', src], {
    cwd: root,
    encoding: 'utf8'
  })
  return listing
    .split('\0')
    .filter((path) => SOURCE_FILE.test(path) && !SKIPPED_FILE.test(path) && path.includes(only))
}

/** The expression inside any `as`, `satisfies` and parentheses wrapping. */
function unwrap(ts, node) {
  let current = node
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/** Whether the node is `<expression> as const`. */
function isConstAssertion(ts, node) {
  return ts.isAsExpression(node) && node.type.getText() === 'const'
}

/** Every object or array literal asserted `as const`, with or without a `satisfies` after it. */
function constTables(ts, sourceFile) {
  const tables = []
  const visit = (node) => {
    const asserted = ts.isSatisfiesExpression(node) ? node.expression : node
    if (isConstAssertion(ts, asserted)) {
      const literal = unwrap(ts, asserted)
      if (ts.isObjectLiteralExpression(literal) || ts.isArrayLiteralExpression(literal)) {
        tables.push(literal)
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return tables
}

/** The text with one entry cut out, together with the comma that separates it from its neighbour. */
function withoutEntry(text, entry) {
  let start = entry.getFullStart()
  let end = entry.getEnd()
  const trailing = text.slice(end).match(/^\s*,/)
  if (trailing) {
    end += trailing[0].length
  } else {
    const leading = text.slice(0, start).match(/,\s*$/)
    if (leading) start -= leading[0].length
  }
  return text.slice(0, start) + text.slice(end)
}

/** The numeric literal an entry holds as its value, or `undefined`. */
function numberOf(ts, entry) {
  const value = ts.isPropertyAssignment(entry) ? entry.initializer : entry
  return ts.isNumericLiteral(value) ? value : undefined
}

/** The text with the entry's number raised by one, or `undefined` when the entry holds none. */
function withNumberBumped(ts, text, entry) {
  const literal = numberOf(ts, entry)
  if (literal === undefined) return undefined
  const bumped = String(Number(literal.text.replaceAll('_', '')) + 1)
  return text.slice(0, literal.getStart()) + bumped + text.slice(literal.getEnd())
}

/** The mutants of one file: for each entry of each table, a removal and possibly a bump. */
function mutantsOf(ts, path, text) {
  if (!text.includes('as const')) return []
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const mutants = []
  for (const table of constTables(ts, sourceFile)) {
    const entries = ts.isObjectLiteralExpression(table) ? table.properties : table.elements
    for (const entry of entries) {
      const line = sourceFile.getLineAndCharacterOfPosition(entry.getStart()).line + 1
      const label = `${path}:${line} ${entry.getText().slice(0, 50).replace(/\s+/g, ' ')}`
      mutants.push({ kind: 'remove', label, text: withoutEntry(text, entry) })
      const bumped = withNumberBumped(ts, text, entry)
      if (bumped !== undefined) mutants.push({ kind: 'bump', label, text: bumped })
    }
  }
  return mutants
}

/** Runs the test command once and returns its exit status; `null` means it was killed. */
function runCommand(root, command, file) {
  const [program, ...args] = command.map((part) => part.replaceAll('{file}', file))
  const result = spawnSync(program, args, {
    cwd: root,
    env: { ...process.env, MUTATED_FILE: file },
    stdio: 'ignore'
  })
  return result.status
}

/** Mutates the files one entry at a time and returns the mutants the command did not kill. */
function survivorsOf(ts, root, files, command) {
  const survivors = []
  let restore = () => {}
  const onSignal = () => {
    restore()
    process.exit(EXIT_USAGE)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  for (const file of files) {
    const absolute = join(root, file)
    const original = readFileSync(absolute, 'utf8')
    restore = () => writeFileSync(absolute, original)
    try {
      for (const mutant of mutantsOf(ts, file, original)) {
        writeFileSync(absolute, mutant.text)
        const killed = runCommand(root, command, file) !== 0
        process.stderr.write(`${killed ? 'killed  ' : 'SURVIVED'} ${mutant.kind} ${mutant.label}\n`)
        if (!killed) survivors.push(mutant)
      }
    } finally {
      restore()
    }
  }
  return survivors
}

/** Parses the arguments, checks the baseline, runs the mutants and prints the survivors. */
function main() {
  const { root, src, only, command } = parseArguments(process.argv.slice(2))
  if (command.length === 0) {
    process.stderr.write(
      'Usage: node scripts/mutate-const-tables.mjs [options] -- <command> [args...]\n'
    )
    process.exit(EXIT_USAGE)
  }
  const files = candidateFiles(root, src, only)
  if (runCommand(root, command, '') !== 0) {
    process.stderr.write('The test command fails on the unmutated tree; fix it first.\n')
    process.exit(EXIT_USAGE)
  }
  const survivors = survivorsOf(loadTypeScript(root), root, files, command)
  if (survivors.length === 0) {
    console.log('Every mutant of every `as const` table was killed.')
    return
  }
  console.log(`${survivors.length} mutant(s) survived; no test pins these entries:`)
  for (const survivor of survivors) console.log(`  ${survivor.kind}  ${survivor.label}`)
  process.exitCode = 1
}

main()
