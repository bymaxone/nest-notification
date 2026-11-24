/**
 * @fileoverview Holds the readiness check's guard against a changed realm to what each clause of it
 * decides: every slot it compares answers `down` on its own, a promise it will not await still
 * gets a handler that can be removed again, a value that is not a promise is never touched, and an
 * answer given while the realm was changed is not kept once the realm is whole again.
 * @layer observability
 */

import { NotificationHealthIndicator } from './notification-health.indicator'

const PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => undefined)()) as object
const CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTOTYPE, 'constructor') as PropertyDescriptor
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout

/** A `then` that no await calls: a value that is not a function, so planting it changes nothing else. */
function plantThen(target: object): void {
  Object.defineProperty(target, 'then', { value: 1, configurable: true, writable: true })
}

function unplantThen(): void {
  Reflect.deleteProperty(Array.prototype, 'then')
  Reflect.deleteProperty(Function.prototype, 'then')
}

afterEach(() => {
  unplantThen()
  Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
  globalThis.clearTimeout = REAL_CLEAR_TIMEOUT
})

/** A provider whose `verify` runs `onVerify` first and answers with what it returns. */
function providerOf(onVerify: () => unknown): never {
  return {
    name: 'smtp',
    isConfigured: (): boolean => true,
    verify: onVerify,
    send: (): never => {
      throw new Error('unused')
    }
  } as never
}

describe('NotificationHealthIndicator when the realm changes while the relay is verified', () => {
  it.each([
    ['Array.prototype', (): void => plantThen(Array.prototype)],
    ['Function.prototype', (): void => plantThen(Function.prototype)],
    [
      'the constructor of Promise.prototype',
      (): void => {
        Object.defineProperty(PROTOTYPE, 'constructor', {
          value: Object,
          configurable: true,
          writable: true
        })
      }
    ]
  ])('should answer down for a relay that is up when %s changed', async (_name, change) => {
    const provider = providerOf(() => {
      change()
      return Promise.resolve()
    })

    const result = await new NotificationHealthIndicator(provider, {}).check()

    expect(result.status).toBe('down')
  })

  it('should answer down when the realm is whole again by the time the verification is cleaned up', async () => {
    globalThis.clearTimeout = ((handle: NodeJS.Timeout): void => {
      unplantThen()
      REAL_CLEAR_TIMEOUT(handle)
    }) as typeof clearTimeout
    const provider = providerOf(() => {
      plantThen(Array.prototype)
      return Promise.resolve()
    })

    const result = await new NotificationHealthIndicator(provider, {}).check()

    expect(result.status).toBe('down')
  })

  it('should neither read nor change a value that is not a promise', async () => {
    let reads = 0
    const answer: Record<string, unknown> = {}
    Object.defineProperty(answer, 'then', {
      get(): undefined {
        reads += 1
        return undefined
      }
    })
    const provider = providerOf(() => {
      plantThen(Array.prototype)
      return answer
    })

    const result = await new NotificationHealthIndicator(provider, {}).check()

    expect([result.status, reads, Object.hasOwn(answer, 'constructor')]).toStrictEqual([
      'down',
      0,
      false
    ])
  })

  it('should give a rejected promise a handler and leave its constructor removable', async () => {
    const relay = Promise.reject(new Error('relay down'))
    const provider = providerOf(() => {
      plantThen(Array.prototype)
      return relay
    })

    const result = await new NotificationHealthIndicator(provider, {}).check()
    const held = Object.getOwnPropertyDescriptor(relay, 'constructor')

    expect([result.status, held?.configurable, held?.value]).toStrictEqual([
      'down',
      true,
      undefined
    ])
  })
})
