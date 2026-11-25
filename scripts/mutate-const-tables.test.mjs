/**
 * @fileoverview Self-test for the verdicts of `mutate-const-tables.mjs`: each fixture command ends
 * the way a test runner does, and the test pins the verdict the script gives it.
 * @layer scripts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

process.env.CONST_TABLES_TIMEOUT_MS = '1000'

const target = process.env.CONST_TABLES_SCRIPT
  ? pathToFileURL(resolve(process.env.CONST_TABLES_SCRIPT)).href
  : new URL('./mutate-const-tables.mjs', import.meta.url).href
const { judge } = await import(target)

/** A command that prints `text` to stderr, then exits with `code` or dies from `signal`. */
const fixture = (text, { code = 0, signal = null } = {}) => [
  process.execPath,
  '-e',
  `process.stderr.write(${JSON.stringify(text)}); ${signal ? `process.kill(process.pid, '${signal}')` : `process.exit(${code})`}`,
  '--'
]

const verdict = (command) => judge(process.cwd(), command, 'src/x.ts')

test('a failed assertion is killed', async () => {
  const out =
    '● table › pins it\n  expect(received).toStrictEqual(expected)\nTests:       1 failed, 3 passed, 4 total\n'
  assert.equal(await verdict(fixture(out, { code: 1 })), 'killed')
})

test('a green run survived', async () => {
  assert.equal(await verdict(fixture('Tests:       4 passed, 4 total\n')), 'survived')
})

test('a suite that failed to run is a load failure, not a kill', async () => {
  const out = '● Test suite failed to run\n  TypeError: x is undefined\nTests:       0 total\n'
  assert.equal(await verdict(fixture(out, { code: 1 })), 'load-failure')
})

test('a run killed by a signal is crash-only', async () => {
  assert.equal(await verdict(fixture('', { signal: 'SIGSEGV' })), 'crash')
})

test('a failure with no test summary is crash-only', async () => {
  assert.equal(
    await verdict(fixture('Jest worker encountered 4 child process exceptions\n', { code: 1 })),
    'crash'
  )
  assert.equal(await verdict(fixture('', { code: 1 })), 'crash')
})

test('a command that hangs, with a child that holds the output open, is stopped and is a timeout', async () => {
  const hang = ['sh', '-c', 'sleep 600 & wait', '--']
  const started = Date.now()
  assert.equal(await verdict(hang), 'timeout')
  assert.ok(Date.now() - started < 10_000)
})

test('every run gets --forceExit, and the in-band rerun drops the worker count', async () => {
  // Fails an assertion only when the flags arrive as the runner needs them.
  const script = `
    const args = process.argv.slice(1)
    const inBand = args.includes('--runInBand')
    if (!inBand) process.exit(1)
    const ok = args.includes('--forceExit') && !args.some((a) => a.startsWith('--maxWorkers') || a === '1')
    process.stderr.write(ok ? 'Tests:       1 failed, 1 total\\n' : '')
    process.exit(1)
  `
  const command = [process.execPath, '-e', script, '--', '--maxWorkers', '1']
  assert.equal(await verdict(command), 'killed-after-rerun')
})

test('a failed assertion that only mentions a crash word is still a kill', async () => {
  const output = [
    '  ● spawner › reports a SIGSEGV of the child process',
    '    Expected: "Jest worker encountered out of memory"',
    'Tests:       1 failed, 3 passed, 4 total',
    ''
  ].join('\n')
  assert.equal(await verdict(fixture(output, { code: 1 })), 'killed')
})

test('a runner death beside a failed test is crash-only', async () => {
  for (const death of [
    '    Jest worker encountered 4 child process exceptions, exceeding retry limit',
    '    A jest worker process (pid=7) was terminated by another process: signal=SIGSEGV',
    'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'
  ]) {
    const output = `${death}\nTests:       1 failed, 1 total\n`
    assert.equal(await verdict(fixture(output, { code: 1 })), 'crash', death)
  }
})

test('the report of a failed test is not searched for crash markers', async () => {
  const output = [
    '  ● spawner › names the child process',
    '',
    '    Jest worker encountered 4 child process exceptions, exceeding retry limit',
    '',
    '      > 3 |   throw new Error("Test suite failed to run")',
    '',
    'Tests:       1 failed, 3 passed, 4 total',
    ''
  ].join('\n')
  assert.equal(await verdict(fixture(output, { code: 1 })), 'killed')
})
