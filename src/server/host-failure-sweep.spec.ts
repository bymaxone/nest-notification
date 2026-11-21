/**
 * @fileoverview Sweeps the host objects the services call, one operation at a time: a proxy whose
 * Nth operation throws, for every N the call reaches, and the call must end in a result or in a
 * `NotificationException`, never in the host's own error. The sweep proves the property for
 * operations nobody listed, which a table of cases cannot.
 *
 * The options are not swept: they are read once, while the module is built, and a failure there is
 * the host's own at start-up and not an answer to a caller.
 * @layer application
 */

import { NotificationException } from './errors/notification-exception'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import {
  baseInput,
  makeAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from './services/__tests__/email-service.fixtures'
import { makeAudit as makeOtpAudit, makeOptions } from './services/__tests__/otp-service.fixtures'
import { EmailService } from './services/email.service'
import { OtpService } from './services/otp.service'

class HostFailure extends Error {}

interface Armed {
  /** Traps the proxy has seen since it was armed. */
  seen: number
  armed: boolean
  /** The operation that throws. */
  at: number
}

/** A proxy over `target` whose `armed.at`th operation throws a {@link HostFailure}. */
function failingAt<T extends object>(target: T, state: Armed): T {
  const count = (): void => {
    if (!state.armed) {
      return
    }
    state.seen += 1
    if (state.seen === state.at) {
      throw new HostFailure('host failure')
    }
  }
  return new Proxy(target, {
    get(object, key, receiver) {
      count()
      const value = Reflect.get(object, key, receiver) as unknown
      return typeof value === 'function' ? value.bind(object) : value
    },
    has(object, key) {
      count()
      return Reflect.has(object, key)
    },
    ownKeys(object) {
      count()
      return Reflect.ownKeys(object)
    },
    getOwnPropertyDescriptor(object, key) {
      count()
      return Reflect.getOwnPropertyDescriptor(object, key)
    },
    getPrototypeOf(object) {
      count()
      return Reflect.getPrototypeOf(object)
    }
  })
}

/**
 * Runs `build` for N = 1, 2, ... until a call no longer reaches its Nth operation, and returns
 * how each N ended.
 */
async function sweep(
  build: (state: Armed) => () => Promise<unknown>
): Promise<{ reached: number; ended: unknown[] }> {
  const ended: unknown[] = []
  for (let at = 1; at < 100; at += 1) {
    const state: Armed = { seen: 0, armed: false, at }
    const run = build(state)
    state.armed = true
    ended.push(
      await run().then(
        () => 'result',
        (error: unknown) => error
      )
    )
    if (state.seen < at) {
      return { reached: at - 1, ended: ended.slice(0, -1) }
    }
  }
  throw new Error('the call kept reaching new operations')
}

/** The outcomes that are not a result: none may be the host's own error. */
function expectNoHostFailure(ended: unknown[]): void {
  for (const outcome of ended) {
    expect(outcome === 'result' || outcome instanceof NotificationException).toBe(true)
  }
}

const otp = { tenantId: 'acme', recipient: 'a@example.com', purpose: 'login' }

describe('host failure sweep', () => {
  it('should end an email send in a result or a NotificationException at every provider operation', async () => {
    const { reached, ended } = await sweep((state) => {
      const service = new EmailService(
        makeEmailOptions(),
        failingAt(makeProvider(), state),
        makeRenderer(),
        makeAudit()
      )
      return () => service.send(baseInput)
    })

    expect(reached).toBeGreaterThan(1)
    expectNoHostFailure(ended)
  })

  it('should end an OTP generate in a result or a NotificationException at every storage operation', async () => {
    const { reached, ended } = await sweep((state) => {
      const service = new OtpService(
        makeOptions({}),
        failingAt(new InMemoryOtpStorage(), state),
        makeOtpAudit()
      )
      return () => service.generate({ ...otp, deliverVia: 'manual' })
    })

    expect(reached).toBeGreaterThan(1)
    expectNoHostFailure(ended)
  })

  it('should end an OTP verify in a result or a NotificationException at every storage operation', async () => {
    const { reached, ended } = await sweep((state) => {
      const storage = new InMemoryOtpStorage()
      const service = new OtpService(makeOptions({}), failingAt(storage, state), makeOtpAudit())
      return async () => {
        state.armed = false
        await new OtpService(makeOptions({}), storage, makeOtpAudit()).generate({
          ...otp,
          deliverVia: 'manual'
        })
        state.armed = true
        return service.verify({ ...otp, code: 'ABCDEF' })
      }
    })

    expect(reached).toBeGreaterThan(1)
    expectNoHostFailure(ended)
  })
})
