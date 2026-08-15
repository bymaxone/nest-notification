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

  // A writable chain is scrubbed IN PLACE — the head keeps its identity (and
  // therefore its class, e.g. a NotificationException stays one).
  it('should preserve the identity of a writable head', () => {
    const error = new Error('boom 555')

    const returned = scrubValuesFromErrorChain(error, ['555'])

    expect(returned).toBe(error)
    expect(error.message).toBe(`boom ${REDACTED_VALUE}`)
  })

  // A frozen foreign error cannot be mutated; the scrub must return a redacted
  // COPY instead — never an unredacted original, never a throw. The copy keeps
  // the ORIGINAL (redacted) stack, not a fresh one from inside the scrub.
  it('should replace a frozen head with a redacted copy', () => {
    const child = new Error('child 555')
    const frozen = new Error('frozen 555')
    frozen.cause = child
    const originalStack = frozen.stack
    Object.freeze(frozen)

    const returned = scrubValuesFromErrorChain(frozen, ['555']) as Error

    expect(returned).not.toBe(frozen)
    expect(returned.message).toBe(`frozen ${REDACTED_VALUE}`)
    expect(returned.stack).toBe(originalStack?.split('555').join(REDACTED_VALUE))
    // The writable child was scrubbed in place and stays attached by identity.
    expect(returned.cause).toBe(child)
    expect(child.message).toBe(`child ${REDACTED_VALUE}`)
  })

  // The copy must stay redactable: its name and cause slots are writable, so a
  // SECOND scrub with a different secret still works in place — pins the
  // writable descriptors and the name transfer on the copy path.
  it('should produce a copy that a second scrub can redact in place', () => {
    const frozen = new Error('frozen 555 and 666')
    frozen.name = 'REJECT_555_666'
    Object.defineProperty(frozen, 'cause', { value: 'tail 555 666', enumerable: false })
    Object.freeze(frozen)

    const first = scrubValuesFromErrorChain(frozen, ['555']) as Error
    expect(first.name).toBe(`REJECT_${REDACTED_VALUE}_666`)
    expect(first.cause).toBe(`tail ${REDACTED_VALUE} 666`)

    const second = scrubValuesFromErrorChain(first, ['666'])
    expect(second).toBe(first)
    expect(first.name).toBe(`REJECT_${REDACTED_VALUE}_${REDACTED_VALUE}`)
    expect(first.cause).toBe(`tail ${REDACTED_VALUE} ${REDACTED_VALUE}`)
  })

  // A frozen MIDDLE link is replaced inside its writable parent, so the full
  // returned chain is code-free while the parent keeps its identity.
  it('should replace a frozen middle link inside a writable parent', () => {
    const frozenChild = Object.freeze(new Error('frozen child 555'))
    const parent = new Error('parent 555')
    parent.cause = frozenChild

    const returned = scrubValuesFromErrorChain(parent, ['555'])

    expect(returned).toBe(parent)
    expect(parent.cause).not.toBe(frozenChild)
    expect((parent.cause as Error).message).toBe(`frozen child ${REDACTED_VALUE}`)
  })

  // A frozen error whose stack was stripped is copied without poisoning the
  // copy with an `undefined` stack — the copy keeps its own defined stack.
  it('should copy a frozen stackless error and keep a defined stack', () => {
    const bare = new Error('frozen bare 555')
    delete bare.stack
    Object.freeze(bare)

    const returned = scrubValuesFromErrorChain(bare, ['555']) as Error

    expect(returned).not.toBe(bare)
    expect(returned.message).toBe(`frozen bare ${REDACTED_VALUE}`)
    expect(typeof returned.stack).toBe('string')
    // No phantom `cause` key on a copy of an error that had none.
    expect('cause' in returned).toBe(false)
  })

  // A node whose `cause` slot is read-only but whose child was scrubbed in
  // place needs NO cause write — the identity check must skip it so the node
  // itself is not needlessly replaced.
  it('should keep a node whose read-only cause slot points at an in-place-scrubbed child', () => {
    const child = new Error('child 555')
    const parent = new Error('parent 555')
    Object.defineProperty(parent, 'cause', { value: child })

    const returned = scrubValuesFromErrorChain(parent, ['555'])

    expect(returned).toBe(parent)
    expect(parent.cause).toBe(child)
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
    // The key itself must stay absent — never re-created as `stack: undefined`.
    expect('stack' in bare).toBe(false)
    expect(bare.message).toBe(`boom ${REDACTED_VALUE}`)
  })

  // A non-Error head is flattened to a redacted string, uniformly with the
  // cause-link rule — nothing that enters the scrub leaves carrying a secret.
  it('should flatten a non-Error head to a redacted string', () => {
    expect(scrubValuesFromErrorChain('raw 555', ['555'])).toBe(`raw ${REDACTED_VALUE}`)
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
