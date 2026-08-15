import { NotificationException } from '../errors/notification-exception'

import { hostileToString } from './__tests__/redact-fixtures'
import { REDACTED_VALUE, attachCauseIfAbsent, scrubValuesFromErrorChain } from './redact'

describe('scrubValuesFromErrorChain — hostile proxies and lying accessors', () => {
  // SECURITY (regression): classifying a value runs the getPrototypeOf trap —
  // a REVOKED proxy throws right at `instanceof`. Classification fails closed
  // to non-Error and the coercion fails closed to the marker.
  it('should fail closed on a revoked-proxy head', () => {
    const { proxy, revoke } = Proxy.revocable(new Error('shell 555'), {})
    revoke()

    expect(scrubValuesFromErrorChain(proxy, ['555'])).toBe(REDACTED_VALUE)
  })

  // The same hostile classification on a CAUSE link flattens to the marker.
  it('should fail closed on a revoked-proxy cause link', () => {
    const { proxy, revoke } = Proxy.revocable(new Error('shell 555'), {})
    revoke()
    const parent = new Error('parent 555')
    parent.cause = proxy

    const returned = scrubValuesFromErrorChain(parent, ['555']) as Error

    expect(returned).toBe(parent)
    expect(returned.cause).toBe(REDACTED_VALUE)
  })

  // SECURITY (regression): a truthy Reflect.set is not proof — an accessor
  // with a NO-OP setter reports success while keeping the plaintext. Each
  // field is verified by reading back; a lying field forces the copy path.
  it('should copy a node whose message setter is a no-op', () => {
    const node = new Error('shell')
    Object.defineProperty(node, 'message', {
      get: () => 'kept 555',
      set: (value: unknown) => {
        void value
      }
    })

    const returned = scrubValuesFromErrorChain(node, ['555']) as Error

    expect(returned).not.toBe(node)
    expect(returned.message).toBe(`kept ${REDACTED_VALUE}`)
  })

  // Same verification for `name` — a lying name setter forces the copy.
  it('should copy a node whose name setter is a no-op', () => {
    const node = new Error('boom')
    Object.defineProperty(node, 'name', {
      get: () => 'REJECT_555',
      set: (value: unknown) => {
        void value
      }
    })

    const returned = scrubValuesFromErrorChain(node, ['555']) as Error

    expect(returned).not.toBe(node)
    expect(returned.name).toBe(`REJECT_${REDACTED_VALUE}`)
  })

  // Same verification for `stack` — a lying stack setter forces the copy.
  it('should copy a node whose stack setter is a no-op', () => {
    const node = new Error('boom')
    Object.defineProperty(node, 'stack', {
      get: () => 'trace 555',
      set: (value: unknown) => {
        void value
      }
    })

    const returned = scrubValuesFromErrorChain(node, ['555']) as Error

    expect(returned).not.toBe(node)
    expect(returned.stack).toBe(`trace ${REDACTED_VALUE}`)
  })

  // Same verification for `cause` — a lying cause setter (probe "succeeds"
  // but the slot never clears) forces the copy.
  it('should copy a node whose cause setter is a no-op', () => {
    const hidden = new Error('tail 555')
    const node = new Error('boom')
    Object.defineProperty(node, 'cause', {
      get: () => hidden,
      set: (value: unknown) => {
        void value
      }
    })

    const returned = scrubValuesFromErrorChain(node, ['555']) as Error

    expect(returned).not.toBe(node)
    // The captured cause is still walked and scrubbed onto the copy.
    expect(returned.cause).toBe(hidden)
    expect(hidden.message).toBe(`tail ${REDACTED_VALUE}`)
  })

  // SECURITY (regression): a non-Error HEAD whose coercion throws must become
  // the marker — the hostile toString error must never escape the scrub.
  it('should fail closed on a head whose coercion throws', () => {
    expect(scrubValuesFromErrorChain(hostileToString('555'), ['555'])).toBe(REDACTED_VALUE)
  })

  // SECURITY (regression): a non-Error CAUSE TAIL whose coercion throws is
  // flattened to the marker instead of letting the hostile error escape.
  it('should fail closed on a cause tail whose coercion throws', () => {
    const parent = new Error('parent 555')
    parent.cause = hostileToString('555')

    const returned = scrubValuesFromErrorChain(parent, ['555']) as Error

    expect(returned).toBe(parent)
    expect(returned.cause).toBe(REDACTED_VALUE)
  })

  // SECURITY (regression): a response replacement that "succeeds" through a
  // no-op setter while `getResponse()` still exposes the original is caught by
  // the read-back verification — the exception falls to the plain copy.
  it('should copy an exception whose response resists replacement', () => {
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED', { code: '555' })
    const original = exception.getResponse()
    Object.defineProperty(exception, 'response', {
      get: () => original,
      set: (value: unknown) => {
        void value
      }
    })

    const returned = scrubValuesFromErrorChain(exception, ['555']) as Error

    expect(returned).not.toBe(exception)
    expect(JSON.stringify({ ...returned })).not.toContain('555')
  })

  // The options replacement is verified by reading back too — a no-op options
  // setter keeping a stuffed bag forces the copy path.
  it('should copy an exception whose options resist replacement', () => {
    const exception = new NotificationException('OTP_STORAGE_NOT_CONFIGURED')
    const stuffed = { entry: { code: '555' } }
    Object.defineProperty(exception, 'options', {
      get: () => stuffed,
      set: (value: unknown) => {
        void value
      }
    })

    const returned = scrubValuesFromErrorChain(exception, ['555']) as Error

    expect(returned).not.toBe(exception)
    expect(JSON.stringify({ ...returned })).not.toContain('555')
  })

  // SECURITY (regression): a NON-ENUMERABLE extra hides from Object.keys but
  // is still readable by serializers that inspect all own properties — the
  // strip sees every own key via Reflect.ownKeys and deletes it in place.
  it('should delete a non-enumerable extra from a NotificationException', () => {
    const exception = new NotificationException('EMAIL_SEND_FAILED')
    Object.defineProperty(exception, 'entry', {
      value: { code: '555' },
      enumerable: false,
      configurable: true
    })

    const returned = scrubValuesFromErrorChain(exception, ['555'])

    expect(returned).toBe(exception)
    expect(Object.getOwnPropertyNames(exception).includes('entry')).toBe(false)
  })

  // A SYMBOL-keyed extra is equally invisible to Object.keys and equally
  // deleted by the own-keys strip.
  it('should delete a symbol-keyed extra from a scrubbed error', () => {
    const hidden = Symbol('entry')
    const error = new Error('boom 555')
    Object.defineProperty(error, hidden, {
      value: { code: '555' },
      enumerable: false,
      configurable: true
    })

    const returned = scrubValuesFromErrorChain(error, ['555'])

    expect(returned).toBe(error)
    expect(Object.getOwnPropertySymbols(error).includes(hidden)).toBe(false)
  })

  // A non-enumerable, NON-configurable extra resists deletion and forces the
  // copy path — the copy carries no extras at all.
  it('should copy an error with an undeletable non-enumerable extra', () => {
    const error = new Error('boom 555')
    Object.defineProperty(error, 'entry', { value: { code: '555' }, enumerable: false })

    const returned = scrubValuesFromErrorChain(error, ['555']) as Error

    expect(returned).not.toBe(error)
    expect(returned.message).toBe(`boom ${REDACTED_VALUE}`)
    expect(Object.getOwnPropertyNames(returned).includes('entry')).toBe(false)
  })

  // The standard fields are rewritten IN PLACE, never deleted-and-recreated —
  // a scrubbed plain error keeps `message` and `stack` non-enumerable, exactly
  // like a native Error.
  it('should keep message and stack non-enumerable on a scrubbed error', () => {
    const error = new Error('boom 555')
    void error.stack

    scrubValuesFromErrorChain(error, ['555'])

    expect(Object.getOwnPropertyDescriptor(error, 'message')?.enumerable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(error, 'stack')?.enumerable).toBe(false)
    expect(error.message).toBe(`boom ${REDACTED_VALUE}`)
  })

  // The guarded cause attachment reports what verifiably happened and never
  // lets a hostile trap throw past it.
  it('should attach a cause only when the slot is verifiably free', () => {
    const free = new Error('free')
    const taken = new Error('taken', { cause: 'existing' })
    const liar = new Error('liar')
    Object.defineProperty(liar, 'cause', {
      get: () => undefined,
      set: (value: unknown) => {
        void value
      }
    })
    const { proxy, revoke } = Proxy.revocable(new Error('revoked'), {})
    revoke()

    expect(attachCauseIfAbsent(free, 'attached')).toBe(true)
    expect(free.cause).toBe('attached')
    expect(attachCauseIfAbsent(taken, 'attached')).toBe(false)
    expect(taken.cause).toBe('existing')
    expect(attachCauseIfAbsent(liar, 'attached')).toBe(false)
    // A lying set-trap on an error WITHOUT a cause key reports success while
    // writing nothing — the read-back verification catches it.
    const lyingSet = new Proxy(new Error('bare'), { set: () => true })
    expect(attachCauseIfAbsent(lyingSet, 'attached')).toBe(false)
    expect('cause' in lyingSet).toBe(false)
    expect(attachCauseIfAbsent(proxy, 'attached')).toBe(false)
    expect(attachCauseIfAbsent('not an error', 'attached')).toBe(false)
  })

  // SECURITY (regression): the Nest options bag is rebuilt empty — a consumer
  // can stuff payloads into it and serializers spread its enumerable fields.
  it('should rebuild the exception options bag empty', () => {
    const exception = new NotificationException('EMAIL_SEND_FAILED')
    Reflect.set(exception, 'options', { entry: { code: '555' } })

    const returned = scrubValuesFromErrorChain(exception, ['555'])

    expect(returned).toBe(exception)
    expect('options' in exception).toBe(true)
    expect(JSON.stringify({ ...exception })).not.toContain('555')
  })
})
