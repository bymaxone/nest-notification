/**
 * @fileoverview Sweeps the host objects the services call, one operation at a time: a proxy whose
 * Nth operation throws, for every N the call reaches, and the call must end in a result or in a
 * `NotificationException`, never in the host's own error. The proxy is armed before the service is
 * built, so the reads of the constructor are swept with the rest. The sweep proves the property for
 * operations nobody listed, which a table of cases cannot, and for `verify` it proves the one that
 * matters: no fault of the store ever ends in `{ valid: true }`, with the correct code and when the
 * attempts are already used up.
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
  /** Operations the proxy has seen. */
  seen: number
  /** The operation that throws. */
  at: number
  /** Operations seen when the service had been built, set by the run that builds it. */
  built: number
}

/** A proxy over `target` whose `armed.at`th operation throws a {@link HostFailure}. */
function failingAt<T extends object>(target: T, state: Armed): T {
  const count = (): void => {
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

/** How each N of a sweep ended, and how the call ended when no operation was made to fail. */
interface Swept {
  /** The highest N whose operation the call reached. */
  reached: number
  /** The outcome for each N from 1 to `reached`: the result, or what was thrown. */
  faulted: unknown[]
  /** The outcome of a run in which nothing failed. */
  clean: unknown
  /** The operations of the construction, which come before the first of the call. */
  built: number
}

/**
 * Runs `run` for N = 1, 2, ... until a call no longer reaches its Nth operation. `setup` makes
 * what the call needs before the fault is armed; `run` builds the service around a proxy that is
 * armed from its creation and makes the call.
 */
async function sweep<S>(
  setup: () => Promise<S>,
  run: (prepared: S, state: Armed) => Promise<unknown>
): Promise<Swept> {
  const faulted: unknown[] = []
  for (let at = 1; at < 100; at += 1) {
    const state: Armed = { seen: 0, at, built: 0 }
    const outcome = await run(await setup(), state).then(
      (result: unknown) => result,
      (error: unknown) => error
    )
    if (state.seen < at) {
      return { reached: at - 1, faulted, clean: outcome, built: state.built }
    }
    faulted.push(outcome)
  }
  throw new Error('the call kept reaching new operations')
}

/** The outcomes of a fault: a result, or the library's own error, and never the host's. */
function expectNoHostFailure(faulted: unknown[]): void {
  for (const outcome of faulted) {
    expect(outcome instanceof HostFailure).toBe(false)
    expect(outcome instanceof Error ? outcome instanceof NotificationException : true).toBe(true)
  }
}

/**
 * What a fault of the store does to a verification. The construction reads the store under a guard
 * and nothing it reads is a call, so a fault there leaves a store that works and the answer is the
 * clean one; a fault in any operation of the call is an error and never the answer `valid`.
 */
function expectFaultsNeverValid(swept: Swept): void {
  expect(swept.built).toBeGreaterThan(0)
  expect(swept.reached).toBeGreaterThan(swept.built)
  swept.faulted.forEach((outcome, index) => {
    if (index < swept.built) {
      expect(outcome).toEqual(swept.clean)
    } else {
      expect(outcome).not.toEqual({ valid: true })
      expect(outcome).toBeInstanceOf(NotificationException)
    }
  })
}

const otp = { tenantId: 'acme', recipient: 'a@example.com', purpose: 'login' }

/** A real store holding a freshly generated code, and the code. */
async function issued(
  maxAttempts?: number
): Promise<{ storage: InMemoryOtpStorage; code: string }> {
  const storage = new InMemoryOtpStorage()
  const options = makeOptions(maxAttempts === undefined ? {} : { defaultMaxAttempts: maxAttempts })
  await new OtpService(options, storage, makeOtpAudit()).generate({ ...otp, deliverVia: 'manual' })
  const entry = await storage.get(otp.tenantId, otp.recipient, otp.purpose)
  return { storage, code: (entry as { code: string }).code }
}

describe('host failure sweep', () => {
  it('should end an email send in a result or a NotificationException at every provider operation', async () => {
    const { reached, faulted } = await sweep(
      async () => undefined,
      (_prepared, state) =>
        new EmailService(
          makeEmailOptions(),
          failingAt(makeProvider(), state),
          makeRenderer(),
          makeAudit()
        ).send(baseInput)
    )

    expect(reached).toBeGreaterThan(1)
    expectNoHostFailure(faulted)
  })

  it('should end an OTP generate in a result or a NotificationException at every storage operation', async () => {
    const { reached, faulted } = await sweep(
      async () => undefined,
      (_prepared, state) =>
        new OtpService(
          makeOptions({}),
          failingAt(new InMemoryOtpStorage(), state),
          makeOtpAudit()
        ).generate({ ...otp, deliverVia: 'manual' })
    )

    expect(reached).toBeGreaterThan(1)
    expectNoHostFailure(faulted)
  })

  // The wrong code can never be valid, so a sweep with it proves nothing about the property that
  // matters; the correct one must be valid when nothing fails and never when something does.
  it('should never end a verification of the correct code in valid:true when the store fails', async () => {
    const swept = await sweep(issued, ({ storage, code }, state) => {
      const service = new OtpService(makeOptions({}), failingAt(storage, state), makeOtpAudit())
      state.built = state.seen
      return service.verify({ ...otp, code })
    })

    expect(swept.clean).toEqual({ valid: true })
    expectNoHostFailure(swept.faulted)
    expectFaultsNeverValid(swept)
  })

  it('should never let a store fault turn a locked-out code into valid:true', async () => {
    const maxAttempts = 2
    const used = async (): Promise<{ storage: InMemoryOtpStorage; code: string }> => {
      const prepared = await issued(maxAttempts)
      const service = new OtpService(
        makeOptions({ defaultMaxAttempts: maxAttempts }),
        prepared.storage,
        makeOtpAudit()
      )
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await service.verify({ ...otp, code: 'WRONG1' })
      }
      return prepared
    }
    const swept = await sweep(used, ({ storage, code }, state) => {
      const service = new OtpService(
        makeOptions({ defaultMaxAttempts: maxAttempts }),
        failingAt(storage, state),
        makeOtpAudit()
      )
      state.built = state.seen
      return service.verify({ ...otp, code })
    })

    expect(swept.clean).toEqual({ valid: false, reason: 'max_attempts' })
    expectNoHostFailure(swept.faulted)
    expectFaultsNeverValid(swept)
  })
})
