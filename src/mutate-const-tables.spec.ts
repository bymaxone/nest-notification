/**
 * Pins `scripts/mutate-const-tables.mjs`, the development tool that mutates `as const` tables one
 * entry at a time. It is plain Node, so each case runs it as a child process against a throwaway
 * git repository whose test command is a small checker script, and asserts the exit code, what
 * is printed, the exact text of each mutant, and that the mutated file is restored.
 *
 * Layer: repository tooling, tests.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'mutate-const-tables.mjs')
const REPOSITORY_MODULES = resolve(__dirname, '..', 'node_modules')

interface Result {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

const roots: string[] = []

/**
 * Lays out a git repository holding `files` (path to text), with the repository's own
 * `node_modules` linked in so the script finds `typescript`, and a checker that appends the text
 * of the file it is given to a log and exits 1 unless that text includes every `required` snippet.
 */
function repo(files: Record<string, string>, required: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'mutate-const-spec-'))
  roots.push(root)
  spawnSync('git', ['init', '-q'], { cwd: root })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  writeFileSync(join(root, 'package.json'), '{}\n')
  writeFileSync(
    join(root, 'checker.mjs'),
    [
      "import { appendFileSync, readFileSync } from 'node:fs'",
      "const file = process.argv[2] || 'src/table.ts'",
      "const text = readFileSync(file, 'utf8')",
      "appendFileSync('log.jsonl', JSON.stringify(text) + '\\n')",
      `const required = ${JSON.stringify(required)}`,
      'process.exit(required.every((snippet) => text.includes(snippet)) ? 0 : 1)'
    ].join('\n')
  )
  symlinkSync(REPOSITORY_MODULES, join(root, 'node_modules'))
  spawnSync('git', ['add', 'package.json', 'checker.mjs', ...Object.keys(files)], { cwd: root })
  return root
}

/** Runs the script against `root`, with the checker as the test command unless `args` say otherwise. */
function run(
  root: string,
  args: readonly string[] = ['--', 'node', 'checker.mjs', '{file}']
): Result {
  const result = spawnSync('node', [SCRIPT, '--root', root, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** The texts the checker saw, one per run: the unmutated baseline first, then each mutant. */
function seen(root: string): string[] {
  return readFileSync(join(root, 'log.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string)
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const TABLE = 'export const T = { a: 1, b: 2 } as const\n'

describe('mutate-const-tables', () => {
  // A checker that pins every entry by exact text kills the removal and the bump of each one.
  it('should kill every mutant of a table the command pins in full', () => {
    const root = repo({ 'src/table.ts': TABLE }, ['a: 1', 'b: 2'])

    const result = run(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Every mutant of every `as const` table was killed.')
  })

  // The mutants are the contract of the tool, so their exact text is pinned: a removal cuts the
  // entry and one comma, a bump adds one to the number, and the order is entry by entry.
  it('should remove each entry and bump each number, in order', () => {
    const root = repo({ 'src/table.ts': TABLE }, ['a: 1', 'b: 2'])

    run(root)

    expect(seen(root)).toEqual([
      TABLE,
      'export const T = { b: 2 } as const\n',
      'export const T = { a: 2, b: 2 } as const\n',
      'export const T = { a: 1 } as const\n',
      'export const T = { a: 1, b: 3 } as const\n'
    ])
  })

  // An entry no test pins is the point of the tool: it must be named, and the exit code must say
  // so, while a pinned entry must not be listed.
  it('should list the survivors and exit 1 when an entry is not pinned', () => {
    const root = repo({ 'src/table.ts': TABLE }, ['a: 1'])

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('2 mutant(s) survived')
    expect(result.stdout).toContain('remove  src/table.ts:1 b: 2')
    expect(result.stdout).toContain('bump  src/table.ts:1 b: 2')
    expect(result.stdout).not.toContain('a: 1')
  })

  // The tool edits tracked source, so the file must come back exactly, survivors or not.
  it('should restore the mutated file', () => {
    const root = repo({ 'src/table.ts': TABLE }, ['a: 1'])

    run(root)

    expect(readFileSync(join(root, 'src/table.ts'), 'utf8')).toBe(TABLE)
  })

  // Arrays, a trailing `satisfies`, multi-line entries with a trailing comma, and a number with
  // separators are all tables in this codebase.
  it('should mutate arrays, satisfies, multi-line entries and numeric separators', () => {
    const source = [
      "export const L = ['x', 'y'] as const satisfies readonly string[]",
      'export const M = {',
      '  big: 1_000,',
      '  nested: {',
      "    deep: 'v'",
      '  },',
      '} as const',
      ''
    ].join('\n')
    const root = repo({ 'src/table.ts': source }, [])

    run(root)

    const texts = seen(root).slice(1)
    expect(texts).toContain(source.replace("['x', 'y']", "[ 'y']"))
    expect(texts).toContain(source.replace("['x', 'y']", "['x']"))
    expect(texts).toContain(source.replace('1_000', '1001'))
    expect(texts).toContain(source.replace('  big: 1_000,\n', ''))
    expect(texts).toContain(source.replace("  nested: {\n    deep: 'v'\n  },\n", ''))
  })

  // Only an `as const` literal is a table; a plain object, a nested literal inside a table, and
  // a number that is not a plain literal are not separate or extra mutants.
  it('should ignore an object that is not asserted as const', () => {
    const root = repo({ 'src/table.ts': 'export const U = { z: 1 }\n' }, [])

    const result = run(root)

    expect(seen(root)).toHaveLength(1)
    expect(result.status).toBe(0)
  })

  // Specs, tests, declaration files and barrels never hold a table worth mutating.
  it.each(['src/a.spec.ts', 'src/a.test.ts', 'src/a.d.ts', 'src/index.ts'])(
    'should skip %s',
    (path) => {
      const root = repo({ [path]: TABLE, 'src/table.ts': 'export const none = 1\n' }, [])

      run(root)

      expect(seen(root)).toHaveLength(1)
    }
  )

  // `--only` narrows the run to the files whose path contains the text.
  it('should mutate only the files matching --only', () => {
    const root = repo({ 'src/one.ts': TABLE, 'src/two.ts': TABLE.replace('T', 'U') }, [])

    run(root, ['--only', 'two', '--', 'node', 'checker.mjs', 'src/two.ts'])

    expect(seen(root)).toHaveLength(5)
  })

  // `--src` selects the directory; files outside it are left alone.
  it('should mutate only the files under --src', () => {
    const root = repo({ 'lib/one.ts': TABLE, 'src/two.ts': TABLE }, [])

    run(root, ['--src', 'lib', '--', 'node', 'checker.mjs', 'lib/one.ts'])

    expect(seen(root)).toHaveLength(5)
  })

  // The command receives the mutated file's path both in `{file}` and in MUTATED_FILE.
  it('should hand the mutated file to the command', () => {
    const root = repo({ 'src/table.ts': TABLE }, [])
    writeFileSync(
      join(root, 'env.mjs'),
      "import { appendFileSync } from 'node:fs'\nappendFileSync('env.log', `${process.argv[2]}|${process.env.MUTATED_FILE}\\n`)\n"
    )

    run(root, ['--', 'node', 'env.mjs', '{file}'])

    const lines = readFileSync(join(root, 'env.log'), 'utf8').split('\n').filter(Boolean)
    expect(lines[0]).toBe('|')
    expect(lines.slice(1)).toEqual(Array<string>(4).fill('src/table.ts|src/table.ts'))
  })

  // With no command the tool cannot run anything; it must say how to call it.
  it('should print the usage and exit 2 without a command', () => {
    const root = repo({ 'src/table.ts': TABLE }, [])

    const result = run(root, [])

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage: node scripts/mutate-const-tables.mjs')
  })

  // A command that already fails would kill every mutant and report a clean run.
  it('should refuse a command that fails on the unmutated tree', () => {
    const root = repo({ 'src/table.ts': TABLE }, ['never present'])

    const result = run(root)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('fails on the unmutated tree')
    expect(seen(root)).toHaveLength(1)
  })
})
