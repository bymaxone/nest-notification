/**
 * @fileoverview Holds the pinning helpers to naming the boundary in what they refuse, and to pinning
 * exactly what they claim: an unpinnable promise, a polluted realm and a promise held on a descriptor
 * that is only partly the pin each leave the same answer whatever the caller's own checks do.
 * @layer utils
 */

import { checkedAwait, own, ownChecked, pinOnce } from './realm-root'

const PLANT = 'zzOwnerSpecPlant'
const UNPINNABLE = 'promise cannot be pinned, so the operation is refused'
const POLLUTED =
  'Object.prototype holds 1 key(s) or built-in(s) that are not the standard ones, so the operation is refused'

function pollute(): void {
  Object.defineProperty(Object.prototype, PLANT, { value: 1, configurable: true })
}

function clean(): void {
  Reflect.deleteProperty(Object.prototype, PLANT)
}

afterEach(clean)

/** The body of what a call threw, so the code, the message and the details are asserted whole. */
function refusalOf(call: () => unknown): { code: unknown; message: string; details: unknown } {
  try {
    call()
  } catch (error) {
    const body = (error as { getResponse: () => { error: Record<string, unknown> } }).getResponse()
    return {
      code: body.error.code,
      message: body.error.message as string,
      details: body.error.details
    }
  }
  return { code: undefined, message: 'did not refuse', details: undefined }
}

describe('own', () => {
  it('should name the default boundary when a promise cannot be pinned and none is given', () => {
    const refusal = refusalOf(() => own(Object.freeze(Promise.resolve(1))))

    expect(refusal).toStrictEqual({
      code: 'notification.invalid_scope_identifier',
      message: `[OtpService] ${UNPINNABLE}`,
      details: {
        boundary: 'OtpService',
        parameter: 'promise',
        reason: 'cannot be pinned, so the operation is refused'
      }
    })
  })

  it('should name the boundary it was given when a promise cannot be pinned', () => {
    const refusal = refusalOf(() => own(Object.freeze(Promise.resolve(1)), 'Boundary'))

    expect(refusal.message).toBe(`[Boundary] ${UNPINNABLE}`)
  })
})

describe('checkedAwait', () => {
  it('should refuse a polluted realm naming the boundary, and hear the promise it will not await', () => {
    const pending = Promise.reject(new Error('relay down'))
    pollute()

    const refusal = refusalOf(() => checkedAwait(pending, 'Boundary'))
    clean()

    expect([refusal.message, Object.hasOwn(pending, 'constructor')]).toStrictEqual([
      `[Boundary] ${POLLUTED}`,
      true
    ])
  })
})

describe('ownChecked', () => {
  it('should refuse a polluted realm with a rejection whose then cannot be replaced', async () => {
    pollute()
    const answer = ownChecked(Promise.resolve(1), 'Boundary')
    clean()

    const then = Object.getOwnPropertyDescriptor(answer, 'then')
    const reason = await answer.then(
      () => 'resolved',
      (error: { getResponse: () => { error: { message: string } } }) =>
        error.getResponse().error.message
    )

    expect([then, reason]).toStrictEqual([
      { value: Promise.prototype.then, writable: false, enumerable: false, configurable: false },
      `[Boundary] ${POLLUTED}`
    ])
  })
})

describe('pinOnce', () => {
  const PINNED = { value: Promise, writable: false, enumerable: false, configurable: false }

  it.each([
    ['another constructor', { value: Object, writable: false, configurable: false }, 'refused'],
    ['a writable constructor', { value: Promise, writable: true, configurable: false }, PINNED],
    ['a configurable constructor', { value: Promise, writable: false, configurable: true }, PINNED]
  ])('should leave a promise holding %s either refused or pinned in full', (_name, held, after) => {
    const promise = Promise.resolve(1)
    Object.defineProperty(promise, 'constructor', held)

    const refusal = refusalOf(() => pinOnce(promise, 'Boundary'))

    expect(
      after === 'refused'
        ? refusal.message
        : Object.getOwnPropertyDescriptor(promise, 'constructor')
    ).toStrictEqual(after === 'refused' ? `[Boundary] ${UNPINNABLE}` : after)
  })

  it('should return a promise it already pinned without defining the property again', () => {
    const redefined: PropertyKey[] = []
    const held = own(Promise.resolve(1), 'Boundary')
    const watched = new Proxy(held, {
      defineProperty(target, key, descriptor) {
        redefined.push(key)
        return Reflect.defineProperty(target, key, descriptor)
      }
    })

    const answer = pinOnce(watched, 'Boundary')

    expect([answer === watched, redefined]).toStrictEqual([true, []])
  })
})
