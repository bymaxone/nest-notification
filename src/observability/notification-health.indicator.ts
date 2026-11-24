/**
 * @fileoverview The readiness check of the email channel: the provider is configured, and a
 * transport that can be verified has been verified, once, with the answer kept for a while. It
 * never sends a message, and it reports `up` or `down` with no detail.
 * @layer observability
 */

import { types } from 'node:util'

import { BymaxHealthIndicator } from '@bymax-one/nest-core/health'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'
import { Inject, Injectable, Optional } from '@nestjs/common'

import { BYMAX_NOTIFICATION_EMAIL_PROVIDER } from '@bymax-one/nest-notification'
import type { IEmailProvider } from '@bymax-one/nest-notification'

import { NOTIFICATION_HEALTH_NAME } from './constants'

// Taken when the module loads: an `await` reads `constructor` of the promise and calls `then` unless it is
// %Promise%, so the check below compares both with what they were then and never calls either.
const descriptorOf = Object.getOwnPropertyDescriptor
const hasOwn = Object.hasOwn
const assignTo = Object.assign
// The prototype of an async function's promise is what an `await` reads, wherever a polyfill put the global `Promise`.
const NATIVE_PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => undefined)()) as {
  then: typeof Promise.prototype.then
}
const isProxy = types.isProxy
const reflectGet = Reflect.get
const sourceOf = Function.prototype.call.bind(Function.prototype.toString) as (
  value: unknown
) => string
const LOADED_THEN = NATIVE_PROTOTYPE.then
const LOADED_CONSTRUCTOR = loadedConstructor()
const LOADED_SPECIES = fieldOf(LOADED_CONSTRUCTOR as object, Symbol.species, 'get')
// The engine's own %Promise%: the global `Promise` is looked up each time it is named, and a host can swap it.
const NativePromise = LOADED_CONSTRUCTOR as PromiseConstructor

/**
 * A field of the descriptor of an own property, only when the descriptor owns it. A descriptor is an
 * ordinary object: `descriptor?.value` of an accessor reads `Object.prototype.value`.
 */
function fieldOf(holder: object, name: PropertyKey, field: 'value' | 'get'): unknown {
  const descriptor = descriptorOf(holder, name)
  return descriptor !== undefined && hasOwn(descriptor, field)
    ? reflectGet(descriptor, field)
    : undefined
}

/**
 * The `constructor` slot of `Promise.prototype`, accepted only as the engine's own %Promise%: a native
 * function whose `prototype` is the prototype of an async function's promise. A slot replaced before
 * this module loaded would otherwise become the baseline `promisesIntact` compares with.
 */
function loadedConstructor(): unknown {
  const slot = fieldOf(NATIVE_PROTOTYPE, 'constructor', 'value') as
    { prototype: unknown } | undefined
  if (
    typeof slot !== 'function' ||
    isProxy(slot) ||
    !sourceOf(slot).endsWith('{ [native code] }') ||
    slot.prototype !== NATIVE_PROTOTYPE
  ) {
    throw new TypeError('Promise.prototype.constructor is not the engine Promise at load')
  }
  return slot
}

const apply = Reflect.apply
const defineOwn = Object.defineProperty
const createBare = Object.create
const noop = (): void => undefined
const isPromise = types.isPromise

/** Awaits a promise and discards how it ended; the last resort for a promise no handler can be attached to. */
async function absorbRejection(promise: unknown): Promise<void> {
  try {
    await promise
  } catch {
    // Ended in a rejection nobody else will observe.
  }
}

/** Gives a promise that will not be awaited a handler, with the `then` taken at load. Never throws. */
function silence(value: unknown): void {
  try {
    if (!isPromise(value)) {
      return
    }
    try {
      // An own `constructor` answers for the one `then` reads, so a planted or throwing one on
      // `Promise.prototype` cannot keep the handler from being attached; `undefined` also skips
      // the `Promise[Symbol.species]` lookup.
      const descriptor = createBare(null) as { value: unknown; configurable: boolean }
      descriptor.value = undefined
      descriptor.configurable = true
      defineOwn(value, 'constructor', descriptor)
    } catch {
      // A frozen promise keeps the `constructor` it inherits; the handler is still attached, and
      // one that cannot be is absorbed by awaiting it.
      try {
        apply(LOADED_THEN, value, [noop, noop])
      } catch {
        void absorbRejection(value)
      }
      return
    }
    apply(LOADED_THEN, value, [noop, noop])
  } catch {
    // Nothing more can be done for it.
  }
}

/** Whether the promise machinery is what it was at load, with no `then` on the root prototypes. */
function promisesIntact(): boolean {
  return (
    fieldOf(NATIVE_PROTOTYPE, 'then', 'value') === LOADED_THEN &&
    fieldOf(NATIVE_PROTOTYPE, 'constructor', 'value') === LOADED_CONSTRUCTOR &&
    fieldOf(LOADED_CONSTRUCTOR as object, Symbol.species, 'get') === LOADED_SPECIES &&
    !hasOwn(Object.prototype, 'then') &&
    !hasOwn(Array.prototype, 'then') &&
    !hasOwn(Function.prototype, 'then')
  )
}

/** Injection token of the options of {@link NotificationHealthIndicator}. */
export const NOTIFICATION_HEALTH_OPTIONS = Symbol('NOTIFICATION_HEALTH_OPTIONS')

/** How the readiness check behaves; every field is optional. */
export interface NotificationHealthOptions {
  /** How long a successful verification is trusted, in milliseconds. Default `300000`. */
  readonly successTtlMs?: number
  /** How long a failed verification is trusted before the relay is tried again. Default `30000`. */
  readonly failureTtlMs?: number
  /**
   * The longest a verification may take. Keep it below the health indicator timeout of
   * `BymaxCoreModule` (`5000` by default), or the aggregator gives up first. Default `4000`.
   */
  readonly timeoutMs?: number
}

const DEFAULT_SUCCESS_TTL_MS = 300_000
const DEFAULT_FAILURE_TTL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 4_000

/** A provider that can verify its transport without sending. */
interface VerifiableProvider extends IEmailProvider {
  verify(): Promise<void>
}

/**
 * Whether a provider can verify its transport. One whose `verify` cannot be read is counted as able
 * to, so the verification runs, fails, and the channel is `down`, where counting it out would make a
 * broken provider look like one that has nothing to verify.
 */
function canVerify(provider: IEmailProvider): provider is VerifiableProvider {
  try {
    return typeof (provider as Partial<VerifiableProvider>).verify === 'function'
  } catch {
    return true
  }
}

/** Whether the provider says it is configured; one that throws is down, and its text goes nowhere. */
function configured(provider: IEmailProvider): boolean {
  try {
    return provider.isConfigured() === true
  } catch {
    return false
  }
}

/**
 * Reports whether the email channel can be used: `down` when the provider says it is not
 * configured or the relay does not answer, `up` otherwise. A provider that cannot verify (the Resend
 * adapter, which would have to call the API) is `up` once it is configured, since that is all that
 * can be known without a network call.
 */
@BymaxHealthIndicator()
@Injectable()
export class NotificationHealthIndicator implements IHealthIndicator {
  readonly name = NOTIFICATION_HEALTH_NAME

  readonly #options: Required<NotificationHealthOptions>
  #verified: { readonly at: number; readonly up: boolean } | undefined
  #inFlight: Promise<boolean> | undefined

  /**
   * @param provider - The email provider of the module, when the channel is configured.
   * @param options - The check's options.
   */
  constructor(
    @Optional()
    @Inject(BYMAX_NOTIFICATION_EMAIL_PROVIDER)
    private readonly provider?: IEmailProvider | null,
    @Optional()
    @Inject(NOTIFICATION_HEALTH_OPTIONS)
    options?: NotificationHealthOptions
  ) {
    this.#options = {
      successTtlMs: options?.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS,
      failureTtlMs: options?.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    }
  }

  /**
   * Runs the check.
   *
   * @returns `{ status }` and nothing else.
   */
  check(): Promise<HealthIndicatorResult> {
    const answer = this.verdict()
    // The caller's `await` reads `constructor` of this promise and calls `then` unless it is %Promise%:
    // an own, fixed `constructor` makes that await native, so a realm the provider changed answers for nothing.
    const pinned = createBare(null) as PropertyDescriptor
    pinned.value = LOADED_CONSTRUCTOR
    defineOwn(answer, 'constructor', pinned)
    return answer
  }

  /** The check itself; the promise it returns is pinned by {@link NotificationHealthIndicator.check}. */
  private async verdict(): Promise<HealthIndicatorResult> {
    // Checked right before the await, which reads the promise's `constructor`: a realm that changed
    // the promises is answered with `down`, never with a forged `up`.
    const pending = this.isUp()
    // Stryker disable next-line BooleanLiteral: equivalent — this guard is one of up to three that run in the same synchronous stretch (verdict, isUp, verified) after provider.verify() was called, or after the fresh cached answer was read, which skips provider.verify() and the guard in verified, with no host code between them, and promisesIntact() reads only descriptorOf, hasOwn and reflectGet captured at load, so once it returns false it stays false until verdict's own check refuses; the `true` branch is never read, and no test of the public surface can observe it
    const up = promisesIntact() ? await pending : false
    // The last statement before the return: what ran since the await (a timer cleared, a handler
    // settled) is covered, and the object returned is built after the check with nothing between.
    if (promisesIntact()) {
      return { status: up ? 'up' : 'down' }
    }
    // Resolving with an object reads its `then`: one planted on the realm would answer for the
    // result, so the refusal is an object with no prototype, which has none to find.
    return assignTo(createBare(null) as HealthIndicatorResult, { status: 'down' })
  }

  /** Whether the channel can be used: no provider means there is nothing to check. */
  private async isUp(): Promise<boolean> {
    const provider = this.provider
    // The module provides `null` for an absent channel when it is registered asynchronously.
    if (provider === undefined || provider === null) {
      return true
    }
    if (!configured(provider)) {
      return false
    }
    if (!canVerify(provider)) {
      return true
    }
    const pending = this.verified(provider)
    // Awaited here, not returned: returning a promise from an async function reads its `then`.
    // Stryker disable next-line BooleanLiteral: equivalent — this guard is one of up to three that run in the same synchronous stretch (verdict, isUp, verified) after provider.verify() was called, or after the fresh cached answer was read, which skips provider.verify() and the guard in verified, with no host code between them, and promisesIntact() reads only descriptorOf, hasOwn and reflectGet captured at load, so once it returns false it stays false until verdict's own check refuses; the `true` branch is never read, and no test of the public surface can observe it
    const up = promisesIntact() ? await pending : false
    return up
  }

  /** The answer of the last verification while it is fresh, else a new one, shared by all callers. */
  private async verified(provider: VerifiableProvider): Promise<boolean> {
    const last = this.#verified
    if (last !== undefined) {
      const ttl = last.up ? this.#options.successTtlMs : this.#options.failureTtlMs
      if (Date.now() - last.at < ttl) {
        return last.up
      }
    }
    this.#inFlight ??= this.verifyOnce(provider)
    const pending = this.#inFlight
    // Stryker disable next-line BooleanLiteral: equivalent — this guard is one of up to three that run in the same synchronous stretch (verdict, isUp, verified) after provider.verify() was called, or after the fresh cached answer was read, which skips provider.verify() and the guard in verified, with no host code between them, and promisesIntact() reads only descriptorOf, hasOwn and reflectGet captured at load, so once it returns false it stays false until verdict's own check refuses; the `true` branch is never read, and no test of the public surface can observe it
    const up = promisesIntact() ? await pending : false
    if (this.#inFlight === pending) {
      this.#inFlight = undefined
    }
    return up
  }

  /** Verifies once, bounded by the timeout, and keeps the answer. */
  private async verifyOnce(provider: VerifiableProvider): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined
    let up: boolean
    try {
      // The first answer wins and each is a boolean: no `Promise.race`, no `then` to read.
      const pending = new NativePromise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false)
        }, this.#options.timeoutMs)
        void (async (): Promise<void> => {
          let started: unknown
          try {
            started = provider.verify()
            if (!promisesIntact()) {
              // Never awaited on this path: a handler keeps a rejection from ending unhandled.
              silence(started)
              resolve(false)
              return
            }
            if (isPromise(started)) {
              // Heard with the `then` taken at load, never awaited: an own `then` or `constructor` of the
              // host's promise cannot answer `up` for a verification that failed.
              apply(LOADED_THEN, started, [(): void => resolve(true), (): void => resolve(false)])
              return
            }
            await started
            resolve(true)
          } catch {
            // The species lookup of `then` can throw before it attaches its handler; one attached here
            // keeps the relay's rejection from ending unhandled.
            silence(started)
            resolve(false)
          }
        })()
      })
      up = promisesIntact() ? await pending : false
    } finally {
      clearTimeout(timer)
    }
    // An answer given while the realm was changed is about the realm, not the relay: it is not kept.
    if (promisesIntact()) {
      this.#verified = { at: Date.now(), up }
    }
    return up
  }
}
