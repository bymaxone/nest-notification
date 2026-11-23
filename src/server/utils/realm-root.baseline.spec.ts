/**
 * @fileoverview Holds the load baseline of built-ins to what the library's sources call: every static
 * call on a global (`Object.keys`, `Math.max`, `Buffer.from`...) and every call of a method name that
 * a built-in prototype has (an array's `map`, a string's `includes`, a set's `has`...) is a member of
 * the baseline, or is exempt with a reason. The sources are read as syntax, so a comment or a string
 * that mentions a call is not one. A list made by a grep cannot tell receivers apart and misses the
 * next call somebody writes; this one fails on it, and fails on an exemption nothing needs any more.
 * @layer infrastructure
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as ts from 'typescript'

import { BASELINE_MEMBERS } from './realm-root'

/** The globals whose static calls are checked. */
const GLOBALS = [
  'Object',
  'Reflect',
  'Array',
  'Math',
  'Number',
  'String',
  'JSON',
  'Symbol',
  'Promise',
  'Date',
  'Buffer',
  'Error',
  'Set',
  'Map',
  'RegExp',
  'BigInt',
  'Boolean',
  'Intl',
  'process'
] as const

/** What is called and left out of the baseline on purpose, and why. */
const EXEMPT: Readonly<Record<string, string>> = {
  'Date.now':
    'The clock. A host that fakes it in a test (jest or sinon fake timers replace Date after the import) must still send; OTP expiry and cooldown use the live clock, stated in the README.',
  'Promise.all':
    'A flow primitive: no recipient, scope, mask or code decision depends on it, and a test may spy on it.',
  'Promise.resolve':
    'A flow primitive: no recipient, scope, mask or code decision depends on it, and a test may spy on it.'
}

const PROTOTYPES: ReadonlyArray<readonly [string, object]> = [
  ['Array', Array.prototype],
  ['String', String.prototype],
  ['Set', Set.prototype],
  ['Map', Map.prototype],
  ['RegExp', RegExp.prototype],
  ['Function', Function.prototype]
]

/** The names of the methods the prototypes above have. */
const METHOD_NAMES: ReadonlySet<string> = new Set(
  PROTOTYPES.flatMap(([, prototype]) =>
    Object.getOwnPropertyNames(prototype).filter(
      (name) =>
        name !== 'constructor' &&
        typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === 'function'
    )
  )
)

/** Method names a call may carry that belong to other classes too, left out of the baseline with a reason. */
const METHOD_EXEMPT: Readonly<Record<string, string>> = {}

interface Calls {
  readonly statics: Map<string, Set<string>>
  readonly methods: Map<string, Set<string>>
}

/**
 * The source files of the library that ship, read as syntax. Read from the folders and not from git,
 * which the sandbox of a mutation run has no history for.
 */
function sources(): string[] {
  return ['src/server', 'src/react', 'src/shared'].flatMap((folder) =>
    readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .map((file) => join(folder, file))
      .filter((file) => file.endsWith('.ts') && !/\.spec\.ts$|__tests__|\.d\.ts$/u.test(file))
  )
}

/** Every static call on a global and every call of a built-in method name, by file. */
function collect(): Calls {
  const calls: Calls = { statics: new Map(), methods: new Map() }
  const note = (map: Map<string, Set<string>>, key: string, file: string): void => {
    map.set(key, (map.get(key) ?? new Set<string>()).add(file))
  }
  for (const file of sources()) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text
        const receiver = node.expression.expression
        if (ts.isIdentifier(receiver) && (GLOBALS as readonly string[]).includes(receiver.text)) {
          note(calls.statics, `${receiver.text}.${name}`, file)
        } else if (METHOD_NAMES.has(name)) {
          note(calls.methods, name, file)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return calls
}

const calls = collect()

/** Whether the baseline holds `name` of the global `global`. */
const holds = (global: string, name: string): boolean =>
  BASELINE_MEMBERS.some(
    ([holder, key]) => key === name && holder === (globalThis as Record<string, unknown>)[global]
  )

describe('the load baseline of built-ins', () => {
  it('should hold every static call on a global, or have it exempt with a reason', () => {
    const missing = [...calls.statics.keys()].filter((call) => {
      const [global, name] = call.split('.') as [string, string]
      return !holds(global, name) && !(call in EXEMPT)
    })

    expect(missing).toStrictEqual([])
  })

  it('should hold every built-in method name the sources call, or have it exempt with a reason', () => {
    const inBaseline = new Set(BASELINE_MEMBERS.map(([, key]) => String(key)))
    const missing = [...calls.methods.keys()].filter(
      (name) => !inBaseline.has(name) && !(name in METHOD_EXEMPT)
    )

    expect(missing).toStrictEqual([])
  })

  it('should keep no exemption that the sources no longer need', () => {
    const stale = Object.keys(EXEMPT).filter((call) => !calls.statics.has(call))

    expect(stale).toStrictEqual([])
  })

  it('should state a reason for every exemption', () => {
    for (const reason of [...Object.values(EXEMPT), ...Object.values(METHOD_EXEMPT)]) {
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('should read the sources: more than a handful of calls, so an empty read cannot pass', () => {
    expect(calls.statics.size).toBeGreaterThan(20)
    expect(calls.methods.size).toBeGreaterThan(30)
  })
})
