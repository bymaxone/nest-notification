/**
 * @fileoverview The readiness check of the email channel: the provider is configured, and a
 * transport that can be verified has been verified, once, with the answer kept for a while. It
 * never sends a message, and it reports `up` or `down` with no detail.
 * @layer observability
 */

import { BymaxHealthIndicator } from '@bymax-one/nest-core/health'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'
import { Inject, Injectable, Optional } from '@nestjs/common'

import { BYMAX_NOTIFICATION_EMAIL_PROVIDER } from '../server/bymax-notification.constants'
import type { IEmailProvider } from '../server/interfaces/email-provider.interface'
import { NOTIFICATION_HEALTH_NAME } from './constants'

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

/** Whether a provider can verify its transport. */
function canVerify(provider: IEmailProvider): provider is VerifiableProvider {
  return typeof (provider as Partial<VerifiableProvider>).verify === 'function'
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
    private readonly provider?: IEmailProvider,
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
  async check(): Promise<HealthIndicatorResult> {
    return { status: (await this.isUp()) ? 'up' : 'down' }
  }

  /** Whether the channel can be used: no provider means there is nothing to check. */
  private async isUp(): Promise<boolean> {
    const provider = this.provider
    if (provider === undefined) {
      return true
    }
    if (!provider.isConfigured()) {
      return false
    }
    return canVerify(provider) ? this.verified(provider) : true
  }

  /** The answer of the last verification while it is fresh, else a new one, shared by all callers. */
  private verified(provider: VerifiableProvider): Promise<boolean> {
    const last = this.#verified
    if (last !== undefined) {
      const ttl = last.up ? this.#options.successTtlMs : this.#options.failureTtlMs
      if (Date.now() - last.at < ttl) {
        return Promise.resolve(last.up)
      }
    }
    this.#inFlight ??= this.verifyOnce(provider).finally(() => {
      this.#inFlight = undefined
    })
    return this.#inFlight
  }

  /** Verifies once, bounded by the timeout, and keeps the answer. */
  private async verifyOnce(provider: VerifiableProvider): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('verification timed out'))
      }, this.#options.timeoutMs)
    })
    let up = true
    try {
      await Promise.race([provider.verify(), timedOut])
    } catch {
      up = false
    } finally {
      clearTimeout(timer)
    }
    this.#verified = { at: Date.now(), up }
    return up
  }
}
