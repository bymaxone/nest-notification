import { REDACTED_VALUE, redactValues, scrubValuesFromErrorChain } from './redact'

describe('redactValues', () => {
  // Every occurrence of every value must be replaced — a single pass that stops
  // at the first hit would leave later occurrences readable.
  it('should replace every occurrence of every value', () => {
    const result = redactValues('a=111 b=222 a=111', ['111', '222'])

    expect(result).toBe(`a=${REDACTED_VALUE} b=${REDACTED_VALUE} a=${REDACTED_VALUE}`)
  })

  // Splitting on '' would interleave the marker between every character; an
  // empty value must be skipped outright.
  it('should skip an empty value', () => {
    expect(redactValues('abc', [''])).toBe('abc')
  })

  // Text without any occurrence must come back unchanged.
  it('should return the text unchanged when nothing matches', () => {
    expect(redactValues('clean text', ['999999'])).toBe('clean text')
  })
})

describe('scrubValuesFromErrorChain', () => {
  // The traversal is identity-based, so a chain deeper than any fixed bound is
  // scrubbed in full — no unscrubbed tail (regression for the old depth cap).
  it('should scrub every link of an arbitrarily deep chain', () => {
    const nodes = Array.from({ length: 12 }, (_, level) => new Error(`level ${level} code=555`))
    nodes.reduce((parent, node) => {
      parent.cause = node
      return node
    })

    scrubValuesFromErrorChain(nodes[0], ['555'])

    for (const node of nodes) {
      expect(node.message).not.toContain('555')
      expect(node.message).toContain(REDACTED_VALUE)
    }
  })

  // A self-referential chain must terminate — each node is visited exactly once.
  it('should terminate on a cyclic chain with every node scrubbed', () => {
    const first = new Error('first 555')
    const second = new Error('second 555')
    first.cause = second
    second.cause = first

    scrubValuesFromErrorChain(first, ['555'])

    expect(first.message).toBe(`first ${REDACTED_VALUE}`)
    expect(second.message).toBe(`second ${REDACTED_VALUE}`)
  })

  // A frozen foreign error cannot be mutated; the scrub must degrade to
  // best-effort on that node WITHOUT throwing, and still clean its children.
  it('should not throw on a frozen link and still scrub past it', () => {
    const child = new Error('child 555')
    const frozen = new Error('frozen 555')
    frozen.cause = child
    Object.freeze(frozen)

    expect(() => scrubValuesFromErrorChain(frozen, ['555'])).not.toThrow()
    expect(frozen.message).toBe('frozen 555')
    expect(child.message).toBe(`child ${REDACTED_VALUE}`)
  })

  // A materialized stack carries the secret in its header line; the scrub must
  // clean the stack, not only the message.
  it('should scrub a materialized stack', () => {
    const error = new Error('boom 555')
    void error.stack

    scrubValuesFromErrorChain(error, ['555'])

    expect(error.stack).toContain(REDACTED_VALUE)
    expect(error.stack).not.toContain('555')
  })

  // An error whose stack was stripped must be handled without poisoning it —
  // pins the `stack !== undefined` guard.
  it('should leave a missing stack absent', () => {
    const bare = new Error('boom 555')
    delete bare.stack

    scrubValuesFromErrorChain(bare, ['555'])

    expect(bare.stack).toBeUndefined()
    expect(bare.message).toBe(`boom ${REDACTED_VALUE}`)
  })

  // A non-Error head is not the scrub's job (callers flatten those) — it must
  // be a silent no-op, never a throw.
  it('should ignore a non-Error head', () => {
    expect(() => scrubValuesFromErrorChain('raw 555', ['555'])).not.toThrow()
  })

  // `name` is emitted by error serializers just like `message` — a secret
  // riding there must be redacted too.
  it('should scrub the error name', () => {
    const error = new Error('boom')
    error.name = 'REJECT_555'

    scrubValuesFromErrorChain(error, ['555'])

    expect(error.name).toBe(`REJECT_${REDACTED_VALUE}`)
  })

  // A STRING cause link cannot be walked as an Error; it must be flattened to a
  // redacted string in place, or the secret rides the tail verbatim.
  it('should redact a string cause link', () => {
    const error = new Error('boom', { cause: 'body code=555' })

    scrubValuesFromErrorChain(error, ['555'])

    expect(error.cause).toBe(`body code=${REDACTED_VALUE}`)
  })

  // A bare-OBJECT cause link could carry the secret in a property; flattening
  // to its String() form drops every property.
  it('should flatten an object cause link', () => {
    const error = new Error('boom', { cause: { code: '555' } })

    scrubValuesFromErrorChain(error, ['555'])

    expect(error.cause).toBe('[object Object]')
  })

  // `cause: undefined` and `cause: null` are legitimate empty links — they must
  // stay as they are, never become the strings 'undefined'/'null'.
  it('should leave an undefined or null cause link untouched', () => {
    const withUndefined = new Error('boom', { cause: undefined })
    const withNull = new Error('boom', { cause: null })

    scrubValuesFromErrorChain(withUndefined, ['555'])
    scrubValuesFromErrorChain(withNull, ['555'])

    expect(withUndefined.cause).toBeUndefined()
    expect(withNull.cause).toBeNull()
  })
})
