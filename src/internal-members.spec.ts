/**
 * Pins `scripts/internal-members.mjs`, the reader that finds the members a source file tags
 * `@internal`, so that `check:published` can prove none of them reaches a published declaration.
 *
 * Layer: repository tooling, tests. The module is plain Node ESM and is run here as a child
 * process over small source snippets. A shape it names must give the member's own name; a shape
 * it cannot attach a tag to must give fewer members than tags, because that gap is what makes
 * the gate fail loudly instead of passing on a member it never checked.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE = pathToFileURL(resolve(__dirname, '..', 'scripts', 'internal-members.mjs')).href

interface Reading {
  readonly tags: number
  readonly members: readonly string[]
}

/** Reads every snippet in one child process and returns one reading per snippet. */
function read(snippets: readonly string[]): Reading[] {
  const script =
    `import { readFileSync } from 'node:fs'\n` +
    `import { readInternalMembers } from ${JSON.stringify(MODULE)}\n` +
    `const rows = JSON.parse(readFileSync(0, 'utf8'))\n` +
    `console.log(JSON.stringify(rows.map((text) => readInternalMembers(text))))`
  const run = spawnSync('node', ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    input: JSON.stringify(snippets)
  })
  if (run.status !== 0) throw new Error(run.stderr)
  return JSON.parse(run.stdout) as Reading[]
}

const TAG = '/** @internal */'

const NAMED: ReadonlyArray<readonly [string, string, string]> = [
  ['a private field', `${TAG}\nprivate x = 1`, 'x'],
  ['an async method', `${TAG}\nasync run(): Promise<void> {}`, 'run'],
  ['a private async method', `${TAG}\nprivate async run(): Promise<void> {}`, 'run'],
  ['a getter', `${TAG}\nget foo(): string { return '' }`, 'foo'],
  ['a setter', `${TAG}\nset foo(v: string) {}`, 'foo'],
  ['a method called get', `${TAG}\nget(key: string) {}`, 'get'],
  ['stacked modifiers', `${TAG}\nprotected abstract override foo(): void`, 'foo'],
  ['an async generator', `${TAG}\nasync *gen() {}`, 'gen'],
  ['a decorator', `${TAG}\n@Inject() private x: X`, 'x'],
  ['a decorator with a plain argument', `${TAG}\n@Inject(TOKEN) private x: X`, 'x'],
  ['a decorator with an object argument', `${TAG}\n@Foo({ a: 1 }) x: X`, 'x'],
  ['stacked decorators and a line comment', `${TAG}\n@A()\n@B.c\n// why\nx = 1`, 'x'],
  ['a tag among other tags', `/**\n * Text.\n * @internal\n */\nprivate z = 1`, 'z']
]

const REFUSED: ReadonlyArray<readonly [string, string]> = [
  [
    'a decorator whose argument has a nested call',
    `${TAG}\n@Inject(forwardRef(() => X)) private x: X`
  ],
  ['a decorator whose argument spans lines', `${TAG}\n@Foo({\n a: 1\n})\nx: X`],
  ['a #private member', `${TAG}\n#secret = 1`],
  ['a computed member', `${TAG}\n['computed']() {}`],
  ['a block comment between the tag and the member', `${TAG}\n/* note */\nx = 1`],
  ['a tag with no member after it', `class A {\n  ${TAG}\n}`],
  ['a decorator string holding a closing parenthesis', `${TAG}\n@Foo("a)b") y = 1`],
  ['a non-ASCII name', `${TAG}\ncafé = 1`],
  ['a name with a dollar sign', `${TAG}\nx$ = 1`],
  ['a computed generator', `${TAG}\nstatic async *[Symbol.iterator]() {}`],
  ['an exported constant', `${TAG}\nexport const X = 1`],
  ['a function declaration', `${TAG}\nfunction f() {}`],
  [
    'a decorator string with a closing parenthesis and a call-like tail',
    `${TAG}\n@Foo("x)y(") z = 1`
  ],
  [
    'a decorator string with a closing parenthesis and a type-like tail',
    `${TAG}\n@Foo("a)b: ") y = 1`
  ],
  ['a decorator template string', `${TAG}\n@Foo(\`a\`) y = 1`],
  [
    'a line comment holding a URL above an exported constant',
    `${TAG}\n// see http://x.y\nexport const X = 1`
  ],
  ['a line comment with a colon above a function', `${TAG}\n// note: keep\nexport function f() {}`],
  ['a decorator argument list longer than the limit', `${TAG}\n@Foo(${'x'.repeat(3000)}) y = 1`]
]

describe('readInternalMembers', () => {
  it.each(NAMED)('should name the member of %s', (_label, text, name) => {
    const [reading] = read([text])

    expect(reading).toEqual({ tags: 1, members: [name] })
  })

  it.each(REFUSED)('should name fewer members than tags for %s', (_label, text) => {
    const [reading] = read([text])

    expect(reading?.tags).toBe(1)
    expect(reading?.members.length).toBeLessThan(1)
  })

  it('should read every tag in a file in order', () => {
    const [reading] = read([`${TAG}\nprivate a = 1\n\n${TAG}\nasync b() {}`])

    expect(reading).toEqual({ tags: 2, members: ['a', 'b'] })
  })

  // A long run of whitespace after a tag costs one pass, not a retry per character.
  it('should refuse a long whitespace run quickly', () => {
    const started = Date.now()

    const [reading] = read([`${TAG}${'\n'.repeat(50_000)}@`])

    expect(reading).toEqual({ tags: 1, members: [] })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  // A `/** @internal ` with no closing `*/` is not a tag, and thousands of them cost one pass.
  it('should read unterminated comments quickly', () => {
    const started = Date.now()

    const [reading] = read(['/** @internal '.repeat(5000)])

    expect(reading).toEqual({ tags: 0, members: [] })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('should not read a tag inside a comment that ends before the member', () => {
    const [reading] = read([`/** @internal */ /** other */\nprivate x = 1`])

    expect(reading).toEqual({ tags: 1, members: [] })
  })

  // A line comment is read to its newline once, so a long run of them costs one pass.
  it('should read a long run of line comments quickly', () => {
    const started = Date.now()

    const [reading] = read([`${TAG} ${'// '.repeat(5000)}\nclass`])

    expect(reading).toEqual({ tags: 1, members: [] })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  // Many tags on one long line each read their own decorator arguments; the limit bounds the cost.
  it('should bound the work of many tags on one long line', () => {
    const started = Date.now()

    const [reading] = read([`${TAG}@a(${'x'.repeat(10_000)}`.repeat(300)])

    expect(reading?.tags).toBe(300)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  // Each tag's scan stops at the next comment block, so tags that sit inside line comments cost
  // one pass in total, not one pass each.
  it('should read many tags inside line comments quickly', () => {
    const started = Date.now()

    const [reading] = read(['// /** @internal */\n'.repeat(20_000)])

    expect(reading).toEqual({ tags: 20_000, members: [] })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('should find nothing in a file with no tag', () => {
    const [reading] = read(['export class A { private x = 1 }'])

    expect(reading).toEqual({ tags: 0, members: [] })
  })
})
