import { NotificationException } from '../errors/notification-exception'

import { hostileToString } from './__tests__/redact-fixtures'

import {
  REDACTED_VALUE,
  attachCauseIfAbsent,
  coerceRedacted,
  collectEchoedExcerpts,
  readRedactedMessage,
  redactValues,
  scrubValuesFromErrorChain
} from './redact'

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

  // SECURITY (family of a defect measured in a consumer's own scrub): replacing
  // value-by-value over the previous output lets a shorter value consume part of
  // a longer one first — ['123', '1234'] over '1234' would emit '[redacted]4',
  // one digit of a live secret. Matching against the original text is
  // order-independent.
  it('should redact a nested overlap fully regardless of value order', () => {
    expect(redactValues('code 1234 end', ['123', '1234'])).toBe(`code ${REDACTED_VALUE} end`)
    expect(redactValues('code 1234 end', ['1234', '123'])).toBe(`code ${REDACTED_VALUE} end`)
  })

  // Two values overlapping WITHOUT nesting — neither contains the other — is the
  // case no replacement order can fix: replacing either first breaks the other's
  // match and a fragment survives. The merged span covers both.
  it('should merge a non-nested overlap into a single marker', () => {
    expect(redactValues('12345', ['1234', '2345'])).toBe(REDACTED_VALUE)
  })

  // A value nested strictly inside another's span must not shrink the merged
  // span — the tail of the longer secret would survive.
  it('should keep the widest span when one match nests inside another', () => {
    expect(redactValues('abcdefghij', ['abcdefghij', 'cde'])).toBe(REDACTED_VALUE)
  })

  // Two distinct secrets sitting back-to-back are separate matches, not one
  // merged span — each gets its own marker.
  it('should keep adjacent matches as separate markers', () => {
    expect(redactValues('12345678', ['1234', '5678'])).toBe(`${REDACTED_VALUE}${REDACTED_VALUE}`)
  })

  // A value overlapping its own earlier occurrence ('aa' in 'aaa') must cover
  // the full run — consuming match-length at a time would leave the odd tail.
  it('should cover a self-overlapping run completely', () => {
    expect(redactValues('aaa', ['aa'])).toBe(REDACTED_VALUE)
  })

  // A later value must never match inside the marker inserted for an earlier
  // one — 'dact' occurs in '[redacted]' but not in the original text.
  it('should not match a value inside an inserted marker', () => {
    expect(redactValues('a secret b', ['secret', 'dact'])).toBe(`a ${REDACTED_VALUE} b`)
  })

  // Occurrences are replaced in text order even when the values arrive in the
  // opposite order of their positions.
  it('should replace occurrences in text order regardless of value order', () => {
    expect(redactValues('aa and zz', ['zz', 'aa'])).toBe(`${REDACTED_VALUE} and ${REDACTED_VALUE}`)
  })
})

describe('collectEchoedExcerpts', () => {
  const body = '<p>Hello Jane, Your password reset code is 998877. It expires shortly.</p>'

  // An error quoting body content must come back as ONE grown excerpt, not
  // overlapping windows — and the secret inside the echo rides along with it.
  it('should collect a grown excerpt when the error echoes body content', () => {
    const excerpts = collectEchoedExcerpts(
      '550 rejected - body was: Your password reset code is 998877. It expires',
      body
    )

    expect(excerpts).toEqual([' Your password reset code is 998877. It expires'])
  })

  // An error carrying no run of body content collects nothing — the gate that
  // keeps unrelated transport errors (ECONNREFUSED and friends) untouched.
  it('should collect nothing when the error echoes no body content', () => {
    expect(collectEchoedExcerpts('connect ECONNREFUSED 127.0.0.1:1099', body)).toEqual([])
  })

  // Two separate echoes come back as two excerpts, in order.
  it('should collect multiple distinct echoes', () => {
    const excerpts = collectEchoedExcerpts(
      'first: Hello Jane, Your password then: 998877. It expires shortly.',
      body
    )

    expect(excerpts).toEqual(['Hello Jane, Your password ', ' 998877. It expires shortly.'])
  })

  // An echo sitting exactly at the tail of the error text, exactly one window
  // long, must still be caught — pins the loop boundary.
  it('should catch a window-sized echo at the end of the text', () => {
    const tail = body.slice(10, 10 + 16)

    expect(collectEchoedExcerpts(`prefix ${tail}`, body)).toEqual([tail])
  })

  // Below the window size, overlap is treated as coincidence, not echo — a
  // bare 6-digit code without surrounding content is NOT caught (documented
  // limit: declared values are the precise control).
  it('should ignore overlap shorter than the window', () => {
    expect(collectEchoedExcerpts('code 998877 only', body)).toEqual([])
  })

  // The same window can occur more than once in the reference with different
  // continuations; the excerpt must extend along the LONGEST occurrence, not
  // whichever happens to be found first.
  it('should extend along the longest of several window occurrences', () => {
    const window = 'ABCDEFGHIJKLMNOP'
    const reference = `${window}xx filler${window}QRST`

    expect(collectEchoedExcerpts(`err: ${window}QRST!`, reference)).toEqual([`${window}QRST`])
  })
})

describe('coerceRedacted', () => {
  // Coercion runs consumer code; a hostile toString that throws a
  // secret-bearing error must yield the marker, never escape.
  it('should fail closed when coercion throws', () => {
    expect(coerceRedacted(hostileToString('555'), ['555'])).toBe(REDACTED_VALUE)
  })

  // A benign value coerces normally, with secrets redacted.
  it('should coerce and redact a benign value', () => {
    expect(coerceRedacted('body 555', ['555'])).toBe(`body ${REDACTED_VALUE}`)
  })
})

describe('readRedactedMessage', () => {
  // A hostile `message` getter must yield the marker, never escape.
  it('should fail closed when the message getter throws', () => {
    const hostile = new Error('shell')
    Object.defineProperty(hostile, 'message', {
      get: (): never => {
        throw new Error('getter leaked 555')
      }
    })

    expect(readRedactedMessage(hostile, ['555'])).toBe(REDACTED_VALUE)
  })

  // With declared values the message is redacted; without them it passes
  // through untouched.
  it('should redact only when values are declared', () => {
    const error = new Error('body 555')

    expect(readRedactedMessage(error, ['555'])).toBe(`body ${REDACTED_VALUE}`)
    expect(readRedactedMessage(error)).toBe('body 555')
  })

  // A non-Error failure is coerced — and a hostile coercion fails closed.
  it('should coerce non-Error failures and fail closed on hostile ones', () => {
    expect(readRedactedMessage('raw 555', ['555'])).toBe(`raw ${REDACTED_VALUE}`)
    expect(readRedactedMessage(hostileToString('555'), ['555'])).toBe(REDACTED_VALUE)
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

  // A read-only `cause` slot fails the writability probe, so the node is
  // represented by a copy — its child representative could never be attached
  // otherwise. The original still gets its writable fields scrubbed.
  it('should copy a node whose cause slot is read-only', () => {
    const child = new Error('child 555')
    const parent = new Error('parent 555')
    Object.defineProperty(parent, 'cause', { value: child })

    const returned = scrubValuesFromErrorChain(parent, ['555']) as Error

    expect(returned).not.toBe(parent)
    expect(returned.message).toBe(`parent ${REDACTED_VALUE}`)
    expect(returned.cause).toBe(child)
    expect(child.message).toBe(`child ${REDACTED_VALUE}`)
  })

  // A writable node WITH a cause keeps its identity — pins the probe's
  // same-value cause write against a mutant that forces the copy path.
  it('should preserve the identity of a writable node with a cause', () => {
    const child = new Error('child 555')
    const parent = new Error('parent 555')
    parent.cause = child

    const returned = scrubValuesFromErrorChain(parent, ['555'])

    expect(returned).toBe(parent)
    expect(parent.cause).toBe(child)
  })

  // An in-place node's cause is rewired through its SETTER (Reflect.set) —
  // never redefined: a non-configurable accessor slot makes defineProperty
  // throw where plain assignment succeeds.
  it('should rewire through a non-configurable cause accessor', () => {
    const frozenChild = Object.freeze(new Error('accessor child 555'))
    const parent = new Error('parent 555')
    let stored: unknown = frozenChild
    Object.defineProperty(parent, 'cause', {
      get: () => stored,
      set: (value: unknown) => {
        stored = value
      }
    })

    const returned = scrubValuesFromErrorChain(parent, ['555'])

    expect(returned).toBe(parent)
    expect(parent.cause).not.toBe(frozenChild)
    expect((parent.cause as Error).message).toBe(`accessor child ${REDACTED_VALUE}`)
  })

  // SECURITY (regression): a cycle THROUGH a frozen node must not retain an
  // unredacted back-edge. With frozen `a` → `b` → `a`, the returned graph must
  // wire `b.cause` to a's redacted REPRESENTATIVE — never to the original
  // frozen `a`, whose message still carries the secret.
  it('should rewire a cyclic back-edge away from a frozen original', () => {
    const frozenA = new Error('a holds 555')
    const b = new Error('b holds 555')
    frozenA.cause = b
    b.cause = frozenA
    Object.freeze(frozenA)

    const returned = scrubValuesFromErrorChain(frozenA, ['555']) as Error

    expect(returned).not.toBe(frozenA)
    expect(returned.message).toBe(`a holds ${REDACTED_VALUE}`)
    expect(returned.cause).toBe(b)
    expect(b.cause).not.toBe(frozenA)
    expect(b.cause).toBe(returned)
    // Walk the returned graph: no node may carry the secret.
    const visited = new Set<unknown>()
    let cursor: unknown = returned
    while (cursor instanceof Error && !visited.has(cursor)) {
      visited.add(cursor)
      expect(cursor.message.includes('555')).toBe(false)
      cursor = cursor.cause
    }
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

  // `undefined` and `null` heads are legitimate empties — passed through, never
  // turned into the strings 'undefined'/'null'.
  it('should pass an undefined or null head through untouched', () => {
    expect(scrubValuesFromErrorChain(undefined, ['555'])).toBeUndefined()
    expect(scrubValuesFromErrorChain(null, ['555'])).toBeNull()
  })

  // SECURITY (regression): a storage may reject with
  // `Object.assign(new Error(...), { entry })` where the entry carries the
  // code — payload-bearing own enumerable properties are deleted, since a
  // serializer that includes enumerable fields would emit them.
  it('should strip payload-bearing enumerable properties from a writable error', () => {
    const error = Object.assign(new Error('write failed'), { entry: { code: '555' } })

    const returned = scrubValuesFromErrorChain(error, ['555'])

    expect(returned).toBe(error)
    expect(Object.keys(error)).toEqual([])
    expect(JSON.stringify({ ...error })).not.toContain('555')
  })

  // A non-configurable payload property resists deletion, so the node is
  // represented by a copy — which carries no extra properties at all.
  it('should copy an error whose payload property resists deletion', () => {
    const error = new Error('write failed 555')
    Object.defineProperty(error, 'entry', {
      value: { code: '555' },
      enumerable: true
    })

    const returned = scrubValuesFromErrorChain(error, ['555']) as Error

    expect(returned).not.toBe(error)
    expect(returned.message).toBe(`write failed ${REDACTED_VALUE}`)
    expect(Object.keys(returned)).toEqual([])
    expect(JSON.stringify({ ...returned })).not.toContain('555')
  })

  // A NotificationException keeps its contract properties (code, response,
  // status) — never stripped, since consumers and the Nest filter rely on the
  // shape — while benign detail values pass through unchanged.
  it('should keep the NotificationException contract properties intact', () => {
    const exception = new NotificationException(
      'EMAIL_SEND_FAILED',
      { providerName: 'smtp' },
      { cause: new Error('boom 555') }
    )

    const returned = scrubValuesFromErrorChain(exception, ['555'])

    expect(returned).toBe(exception)
    expect(exception.code).toBe('notification.email_send_failed')
    expect(exception.getResponse()).toMatchObject({
      error: { details: { providerName: 'smtp' } }
    })
    expect((exception.cause as Error).message).toBe(`boom ${REDACTED_VALUE}`)
  })

  // SECURITY (regression): a CONSUMER-constructed NotificationException may
  // carry the secret in caller-supplied details — the response body is
  // deep-redacted (nested objects, arrays, and numeric forms included), not
  // trusted by class.
  it('should deep-redact secrets inside a NotificationException response', () => {
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', {
      code: '555',
      nested: { dump: 'entry code=555' },
      list: ['x', '555'],
      numeric: 555,
      big: 555n,
      benign: 42,
      emptyList: []
    })

    scrubValuesFromErrorChain(exception, ['555'])

    const details = (exception.getResponse() as { error: { details: Record<string, unknown> } })
      .error.details
    expect(details.code).toBe(REDACTED_VALUE)
    expect(details.nested).toEqual({ dump: `entry code=${REDACTED_VALUE}` })
    expect(details.list).toEqual(['x', REDACTED_VALUE])
    expect(details.numeric).toBe(REDACTED_VALUE)
    expect(details.big).toBe(REDACTED_VALUE)
    // A number that does not carry the secret keeps its type and value.
    expect(details.benign).toBe(42)
    // An empty array clones to an empty array — nothing invented.
    expect(details.emptyList).toEqual([])
    expect(JSON.stringify(exception.getResponse())).not.toContain('555')
  })

  // SECURITY (regression): a secret can ride a property NAME — detail keys are
  // redacted like values.
  it('should redact secrets inside detail keys', () => {
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', {
      ['otp_555']: true
    })

    scrubValuesFromErrorChain(exception, ['555'])

    const details = (exception.getResponse() as { error: { details: Record<string, unknown> } })
      .error.details
    expect(details[`otp_${REDACTED_VALUE}`]).toBe(true)
    expect(JSON.stringify(exception.getResponse())).not.toContain('555')
  })

  // SECURITY (regression): an error whose OWN field getters throw must yield a
  // minimal redacted copy — the hostile getter's (potentially secret-bearing)
  // error must never escape the scrub.
  it('should represent an error with throwing field getters by a minimal copy', () => {
    const hostile = new Error('shell')
    Object.defineProperty(hostile, 'message', {
      get: (): never => {
        throw new Error('getter leaked 555')
      }
    })

    const returned = scrubValuesFromErrorChain(hostile, ['555']) as Error

    expect(returned).not.toBe(hostile)
    expect(returned.message).toBe(REDACTED_VALUE)
    expect(returned.name).toBe('Error')
    expect('cause' in returned).toBe(false)
  })

  // SECURITY (regression): consumer-added enumerable extras on a
  // NotificationException (`Object.assign(exception, { entry })`) are deleted —
  // they can carry the secret just like on a raw error — while the contract
  // fields all survive the strip-and-rewrite.
  it('should strip consumer-added extras from a NotificationException', () => {
    const exception = Object.assign(
      new NotificationException('EMAIL_SEND_FAILED', { providerName: 'smtp' }),
      { entry: { code: '555' } }
    )

    const returned = scrubValuesFromErrorChain(exception, ['555'])

    expect(returned).toBe(exception)
    expect('entry' in exception).toBe(false)
    expect(exception.code).toBe('notification.email_send_failed')
    expect(exception.getStatus()).toBe(502)
    expect('options' in exception).toBe(true)
    expect(exception.message).toBe('Notification Exception')
    expect(exception.name).toBe('NotificationException')
    expect(JSON.stringify({ ...exception })).not.toContain('555')
  })

  // A NON-DELETABLE consumer extra forces the whole exception down the copy
  // path — losing the class beats leaking the payload.
  it('should copy a NotificationException with a non-deletable extra', () => {
    const exception = new NotificationException('EMAIL_SEND_FAILED')
    Object.defineProperty(exception, 'entry', { value: { code: '555' }, enumerable: true })

    const returned = scrubValuesFromErrorChain(exception, ['555']) as Error

    expect(returned).not.toBe(exception)
    expect(returned).toBeInstanceOf(Error)
    expect(JSON.stringify({ ...returned })).not.toContain('555')
  })

  // SECURITY (regression): a hostile enumerable GETTER in consumer details
  // must never be invoked — a getter that throws a secret-bearing error would
  // otherwise escape mid-clone and replace the failure being scrubbed. The
  // accessor-backed value is withheld as the redaction marker.
  it('should withhold accessor-backed detail values without invoking the getter', () => {
    const details: Record<string, unknown> = { safe: 'kept' }
    Object.defineProperty(details, 'trap', {
      get: (): never => {
        throw new Error('getter leaked 555')
      },
      enumerable: true
    })
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', details)

    expect(() => scrubValuesFromErrorChain(exception, ['555'])).not.toThrow()

    const cloned = (exception.getResponse() as { error: { details: Record<string, unknown> } })
      .error.details
    expect(cloned.safe).toBe('kept')
    expect(cloned.trap).toBe(REDACTED_VALUE)
  })

  // A non-enumerable own detail property is invisible to serializers and is
  // dropped from the clone, mirroring what Object.entries would have exposed.
  it('should drop non-enumerable detail properties from the clone', () => {
    const details: Record<string, unknown> = { visible: 'yes' }
    Object.defineProperty(details, 'hidden', { value: 'secret 555', enumerable: false })
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', details)

    scrubValuesFromErrorChain(exception, ['555'])

    const cloned = (exception.getResponse() as { error: { details: Record<string, unknown> } })
      .error.details
    expect(cloned.visible).toBe('yes')
    expect('hidden' in cloned).toBe(false)
  })

  // SECURITY (regression): when property DISCOVERY itself throws (a Proxy
  // ownKeys trap), the clone fails closed to an empty object — never lets the
  // trap's error replace the failure being scrubbed.
  it('should fail closed when detail discovery throws', () => {
    const trap = new Proxy(
      {},
      {
        ownKeys: (): never => {
          throw new Error('trap leaked 555')
        }
      }
    ) as Record<string, unknown>
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', trap)

    expect(() => scrubValuesFromErrorChain(exception, ['555'])).not.toThrow()
    expect((exception.getResponse() as { error: { details: unknown } }).error.details).toEqual({})
  })

  // The strip path fails closed the same way: an ERROR whose key discovery
  // throws (a Proxy trap) is represented by a redacted copy, never rethrown
  // through the trap.
  it('should copy an error whose key discovery throws', () => {
    const hostile = new Proxy(new Error('proxied 555'), {
      ownKeys: (): never => {
        throw new Error('trap leaked 555')
      }
    })

    const returned = scrubValuesFromErrorChain(hostile, ['555']) as Error

    expect(returned).not.toBe(hostile)
    expect(returned.message).toBe(`proxied ${REDACTED_VALUE}`)
  })

  // SECURITY (regression): two source keys that redact to the SAME target key
  // must not throw on the second define — the collision overwrites (last
  // wins) instead of replacing the failure being scrubbed with a TypeError.
  it('should survive a redacted-key collision', () => {
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', {
      ['otp_555']: 'first',
      [`otp_${REDACTED_VALUE}`]: 'second'
    })

    expect(() => scrubValuesFromErrorChain(exception, ['555'])).not.toThrow()

    const details = (exception.getResponse() as { error: { details: Record<string, unknown> } })
      .error.details
    expect(details[`otp_${REDACTED_VALUE}`]).toBe('second')
    expect(JSON.stringify(exception.getResponse())).not.toContain('555')
  })

  // A `__proto__` detail key must become a harmless OWN property of the clone,
  // never a prototype write (defineProperty semantics), and no global
  // prototype pollution may occur.
  it('should treat a __proto__ detail key as an own property', () => {
    const details = JSON.parse('{"__proto__": {"polluted": "555"}}') as Record<string, unknown>
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', details)

    scrubValuesFromErrorChain(exception, ['555'])

    expect('polluted' in {}).toBe(false)
    const clonedDetails = (
      exception.getResponse() as { error: { details: Record<string, unknown> } }
    ).error.details
    const own = Object.getOwnPropertyDescriptor(clonedDetails, '__proto__')
    expect(own?.value).toEqual({ polluted: REDACTED_VALUE })
    expect(Object.getPrototypeOf(clonedDetails)).toBe(Object.prototype)
  })

  // SECURITY (regression): an adversarially DEEP chain must be scrubbed
  // iteratively — a recursive walk would blow the call stack and replace the
  // original failure with a RangeError, bypassing scrub and audit.
  it('should scrub a 50k-link chain without exhausting the call stack', () => {
    const nodes = Array.from({ length: 50_000 }, (_, level) => {
      const node = new Error(`level ${level} 555`)
      delete node.stack
      return node
    })
    nodes.reduce((parent, node) => {
      parent.cause = node
      return node
    })

    const returned = scrubValuesFromErrorChain(nodes[0], ['555']) as Error

    expect(returned).toBe(nodes[0])
    expect(nodes.at(0)?.message).toBe(`level 0 ${REDACTED_VALUE}`)
    expect(nodes.at(-1)?.message).toBe(`level 49999 ${REDACTED_VALUE}`)
  })

  // The clone walk is iterative too — deeply nested caller-supplied details
  // must not exhaust the call stack.
  it('should clone 50k-deep details without exhausting the call stack', () => {
    let nested: Record<string, unknown> = { leaf: '555' }
    for (let level = 0; level < 50_000; level += 1) {
      nested = { inner: nested }
    }
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', nested)

    scrubValuesFromErrorChain(exception, ['555'])

    let cursor = (exception.getResponse() as { error: { details: Record<string, unknown> } }).error
      .details
    while (typeof cursor.inner === 'object' && cursor.inner !== null) {
      cursor = cursor.inner as Record<string, unknown>
    }
    expect(cursor.leaf).toBe(REDACTED_VALUE)
  })

  // SECURITY (regression): FROZEN caller-supplied details cannot defeat the
  // redaction — the response is replaced by a redacted clone, since cloning
  // only reads the source.
  it('should fail closed on frozen caller-supplied details', () => {
    const exception = new NotificationException(
      'OTP_STORAGE_NOT_CONFIGURED',
      Object.freeze({ code: '555' })
    )

    const returned = scrubValuesFromErrorChain(exception, ['555'])

    expect(returned).toBe(exception)
    expect(JSON.stringify(exception.getResponse())).not.toContain('555')
    expect(
      (exception.getResponse() as { error: { details: Record<string, unknown> } }).error.details
        .code
    ).toBe(REDACTED_VALUE)
  })

  // Cyclic caller-supplied details must not hang the deep redaction.
  it('should terminate on cyclic NotificationException details', () => {
    const details: Record<string, unknown> = { code: '555' }
    details.self = details
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', details)

    expect(() => scrubValuesFromErrorChain(exception, ['555'])).not.toThrow()
    expect(
      (exception.getResponse() as { error: { details: Record<string, unknown> } }).error.details
        .code
    ).toBe(REDACTED_VALUE)
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
