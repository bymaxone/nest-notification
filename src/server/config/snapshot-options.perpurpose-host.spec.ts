/**
 * @fileoverview The `perPurpose` container is copied, never kept live, whatever a host's own class
 * checks answer: an accessor `constructor` read through `Object.prototype.value`, or a Proxy that says
 * once that it is a `Map`. A live container is validated with one answer and resolved with another.
 * @layer infrastructure
 */

import type { IOtpStorage } from '../interfaces'

import { snapshotOptions } from './snapshot-options'

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>).value
})

/** A purpose entry whose `length` and `ttlSeconds` read differently the second time. */
function flippingEntry(): Record<string, unknown> {
  let lengths = 0
  let ttls = 0
  return {
    maxAttempts: 3,
    codeType: 'numeric',
    get length() {
      lengths += 1
      return lengths === 1 ? 6 : 1
    },
    get ttlSeconds() {
      ttls += 1
      return ttls === 1 ? 300 : Infinity
    },
    resendCooldownSeconds: 0
  }
}

/** What the snapshot kept: whether it is the host's own object, and what its entry reads afterwards. */
function snapshotOf(perPurpose: object): { live: boolean; later: unknown } {
  const copy = snapshotOptions({
    otp: { storage: {} as IOtpStorage, perPurpose },
    audit: { repository: {} as never }
  } as never)
  const kept = copy.otp?.perPurpose as Record<string, { length: number }> | undefined
  const [first, second] = [kept?.login_mfa?.length, kept?.login_mfa?.length]
  return { live: kept === perPurpose, later: [first, second] }
}

describe('snapshotOptions perPurpose against a host class check that answers once', () => {
  it('should not keep a class instance whose constructor accessor and Object.prototype.value answer', () => {
    class Purposes {
      login_mfa = flippingEntry()
    }
    Object.defineProperty(Purposes.prototype, 'constructor', {
      configurable: true,
      get() {
        return Purposes
      }
    })
    Object.defineProperty(Object.prototype, 'value', {
      configurable: true,
      get() {
        delete (Object.prototype as Record<string, unknown>).value
        return Map
      }
    })

    const result = snapshotOf(new Purposes())

    expect(result.live).toBe(false)
  })

  it('should not keep a Proxy that answers Map.prototype to its first prototype read', () => {
    let reads = 0
    const proxy = new Proxy(
      { login_mfa: flippingEntry() },
      {
        getPrototypeOf() {
          reads += 1
          return reads === 1 ? Map.prototype : Object.prototype
        }
      }
    )

    let outcome: string
    try {
      outcome = snapshotOf(proxy).live ? 'live' : 'copied'
    } catch {
      outcome = 'refused'
    }

    expect(outcome).not.toBe('live')
  })
})
