/**
 * @fileoverview A `Promise[Symbol.species]` getter left in place by a host call is a change of the realm
 * the health check reports, even when it answers honestly: `then`, `catch` and `finally` build their
 * promises through it, and the check answers for a relay no promise of which can then be trusted.
 * @layer observability
 */

import { NotificationHealthIndicator } from './notification-health.indicator'

const SPECIES = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

afterEach(() => {
  Object.defineProperty(Promise, Symbol.species, SPECIES)
})

describe('NotificationHealthIndicator when Promise[Symbol.species] is replaced', () => {
  it('should not report up on a realm whose species getter was swapped', async () => {
    const provider = {
      name: 'p',
      isConfigured: (): boolean => true,
      send: (): never => {
        throw new Error('unused')
      },
      verify: (): Promise<void> => {
        Object.defineProperty(Promise, Symbol.species, {
          configurable: true,
          get: () => Promise
        })
        return Promise.resolve()
      }
    }

    const result = await new NotificationHealthIndicator(provider as never, {}).check()

    expect(result.status).toBe('down')
  })

  it.each([
    ['deleted', (): void => void Reflect.deleteProperty(Promise, Symbol.species)],
    [
      'replaced by a data property',
      (): void => {
        Object.defineProperty(Promise, Symbol.species, { configurable: true, value: Promise })
      }
    ]
  ])('should not report up on a realm whose species was %s', async (_name, change) => {
    const provider = {
      name: 'p',
      isConfigured: (): boolean => true,
      send: (): never => {
        throw new Error('unused')
      },
      verify: (): Promise<void> => {
        change()
        return Promise.resolve()
      }
    }

    const result = await new NotificationHealthIndicator(provider as never, {}).check()

    expect(result.status).toBe('down')
  })
})
