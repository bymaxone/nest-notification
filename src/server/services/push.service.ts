/**
 * @fileoverview Push notification service.
 * @layer application
 *
 * Sends one message to many device tokens through the configured {@link IPushProvider} and answers
 * per token. The library stores no token: the host keeps them and acts on the closed
 * `PushFailureReason` of each result (`token_unregistered` means delete it).
 *
 * What is audited and what is not: one entry per send, naming the tenant, the provider and counts.
 * A device token, the title, the body and the data payload are never written to it, and a provider's
 * own error text is neither audited nor attached to the error a caller receives.
 */

import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common'

import type { PushReceiptResult } from '../../shared/types/push.types'
import {
  BYMAX_NOTIFICATION_AUDIT_SINK,
  BYMAX_NOTIFICATION_OBSERVER,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_PUSH_PROVIDER
} from '../bymax-notification.constants'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import type {
  IPushProvider,
  PushSendOptions,
  PushSendResult
} from '../interfaces/push-provider.interface'
import { writeAudit } from '../utils/audit-write'
import { AuditWriteWarning } from '../utils/audit-write-warning'
import { isUnavailableProviderError } from '../utils/availability'
import { readHostName } from '../utils/host-name'
import { isLibraryError } from '../utils/is-library-error'
import { reportSend, runInSpan } from '../utils/observe'
import { rethrowRefusal } from '../utils/provider-refusal'
import { readIdList, readPush } from '../utils/push-send-input'
import { assertStandardRealmRoot, checkedAwait, own, ownChecked } from '../utils/realm-root'
import { assertIdentifies } from '../utils/tenant-scope'

const OWNER = 'PushService'
const NANOSECONDS_PER_SECOND = 1_000_000_000

/** A push to send. `tokens` is one device token or a list; the rest is the message. */
export interface PushSendInput extends PushSendOptions {
  /** Tenant the send belongs to. */
  tenantId: string
  /** Associated user id, recorded in the audit entry. */
  userId?: string
}

/** Who a send is for and how many tokens it carries; nothing a token or a message holds. */
interface SendScope {
  tenantId: string
  userId: string | undefined
  tokenCount: number
}

/** How far a send got, which decides how the observer counts it. */
interface SendProgress {
  stage: 'before-provider' | 'accepted' | 'failed'
}

/** The 503 mapping the other channels apply: a provider that could not be reached is retryable later. */
function unavailableStatus(error: unknown): { status?: HttpStatus } {
  return isUnavailableProviderError(error) ? { status: HttpStatus.SERVICE_UNAVAILABLE } : {}
}

/** How a send ended, decided by how far it got and not by the error it ended in. */
function outcomeOf(progress: SendProgress, error: unknown): 'sent' | 'failed' | 'rejected' {
  if (progress.stage === 'accepted') {
    return 'sent'
  }
  if (progress.stage === 'failed') {
    return 'failed'
  }
  return isLibraryError(error) ? 'rejected' : 'failed'
}

/** Whether a provider's answer is one result per token, the only shape the service can count. */
function isAnswerFor(answer: unknown, tokenCount: number): answer is PushSendResult {
  const results: unknown = (answer as { results?: unknown } | null | undefined)?.results
  return Array.isArray(results) && results.length === tokenCount
}

/** Push notification service. */
@Injectable()
export class PushService {
  /** @internal */
  private readonly auditWarning = new AuditWriteWarning(new Logger(PushService.name), 'push')

  /**
   * @param options - The resolved, frozen module options.
   * @param provider - The configured push provider.
   * @param auditLog - The audit-log repository (no-op when none configured).
   * @param observer - The optional metrics/tracing observer.
   */
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS)
    private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_PUSH_PROVIDER)
    private readonly provider: IPushProvider,
    @Inject(BYMAX_NOTIFICATION_AUDIT_SINK)
    private readonly auditLog: INotificationLogRepository,
    @Optional()
    @Inject(BYMAX_NOTIFICATION_OBSERVER)
    private readonly observer?: INotificationObserver
  ) {}

  /**
   * Whether the push channel is configured and its provider is ready.
   *
   * @returns `true` when both hold.
   * @throws NotificationException `PUSH_PROVIDER_NOT_CONFIGURED` when the provider's answer is not a boolean.
   */
  isConfigured(): boolean {
    if (!this.options.push) {
      return false
    }
    try {
      const answer: unknown = this.provider.isConfigured()
      if (typeof answer !== 'boolean') {
        throw new NotificationException('PUSH_PROVIDER_NOT_CONFIGURED')
      }
      return answer
    } catch (error) {
      throw new NotificationException('PUSH_PROVIDER_NOT_CONFIGURED', undefined, { cause: error })
    }
  }

  /**
   * Sends a push to one or more device tokens.
   *
   * @param input - The tokens and the message.
   * @returns One result per token, in the order the tokens were given. A token the provider could
   * not serve is a result with a `reason`, not a thrown error, so one bad token never fails its batch.
   * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` (a malformed input), `PUSH_SEND_FAILED`
   * (nothing was sent; 503 when the provider was unreachable), or `AUDIT_LOG_FAILED`.
   */
  send(input: PushSendInput): Promise<PushSendResult> {
    return ownChecked(
      this.observed((progress) => this.sendUnobserved(input, progress)),
      OWNER
    )
  }

  /**
   * Reads the delivery receipts of earlier sends, where the provider has any.
   *
   * @param ticketIds - The `messageId`s of earlier results. A receipt the provider has not produced
   * yet is `pending`.
   * @returns One result per id.
   * @throws NotificationException `CHANNEL_DISABLED` (the provider has no receipts) or `PUSH_SEND_FAILED`.
   */
  fetchReceipts(ticketIds: readonly string[]): Promise<PushReceiptResult[]> {
    return ownChecked(this.receipts(ticketIds), OWNER)
  }

  private async receipts(ticketIds: readonly string[]): Promise<PushReceiptResult[]> {
    const ids = readIdList(OWNER, 'ticketIds', ticketIds)
    const provider = this.provider
    if (typeof provider.fetchReceipts !== 'function') {
      throw new NotificationException('CHANNEL_DISABLED', {
        channel: 'push',
        reason: 'receipts_not_supported'
      })
    }
    try {
      const answer: unknown = await checkedAwait(provider.fetchReceipts(ids), OWNER)
      if (!Array.isArray(answer)) {
        throw new TypeError('not a list')
      }
      assertStandardRealmRoot(OWNER)
      return answer as PushReceiptResult[]
    } catch (error) {
      rethrowRefusal(error)
      throw this.failure(error)
    }
  }

  /** Runs one send inside the observer's span and tells it how the send ended. */
  private async observed<T>(run: (progress: SendProgress) => Promise<T>): Promise<T> {
    const progress: SendProgress = { stage: 'before-provider' }
    const started = process.hrtime.bigint()
    const seconds = (): number => Number(process.hrtime.bigint() - started) / NANOSECONDS_PER_SECOND
    let result: T
    try {
      result = await own(
        runInSpan(
          this.observer,
          'notification.send',
          { channel: 'push' },
          () => run(progress),
          OWNER
        ),
        OWNER
      )
    } catch (error) {
      reportSend(this.observer, {
        channel: 'push',
        outcome: outcomeOf(progress, error),
        seconds: seconds()
      })
      throw error
    }
    reportSend(this.observer, { channel: 'push', outcome: 'sent', seconds: seconds() })
    assertStandardRealmRoot(OWNER)
    return result
  }

  private async sendUnobserved(
    raw: PushSendInput,
    progress: SendProgress
  ): Promise<PushSendResult> {
    const push = this.requireOptions()
    // The envelope is read once: what is validated is what is sent and what is audited.
    const { tenantId, userId } = raw
    assertIdentifies(OWNER, 'tenantId', tenantId)
    const read = readPush(OWNER, raw)
    const ttlSeconds = read.message.ttlSeconds ?? push.defaultTtlSeconds
    const send: PushSendOptions = {
      ...read.message,
      tokens: [...read.tokens],
      ...(ttlSeconds === undefined ? {} : { ttlSeconds })
    }
    const scope: SendScope = { tenantId, userId, tokenCount: read.tokens.length }
    const answer = await own(this.deliver(send, scope, progress), OWNER)
    await own(this.audit(this.auditEntry(scope, answer)), OWNER)
    assertStandardRealmRoot(OWNER)
    return answer
  }

  /** Hands the message to the provider; any failure it raises becomes `PUSH_SEND_FAILED`. */
  private async deliver(
    send: PushSendOptions,
    scope: SendScope,
    progress: SendProgress
  ): Promise<PushSendResult> {
    try {
      const answer: unknown = await checkedAwait(this.provider.send(send), OWNER)
      if (!isAnswerFor(answer, scope.tokenCount)) {
        throw new TypeError('the provider did not answer once per token')
      }
      progress.stage = 'accepted'
      assertStandardRealmRoot(OWNER)
      return answer
    } catch (error) {
      rethrowRefusal(error)
      progress.stage = 'failed'
      await own(this.auditFailure(scope), OWNER)
      throw this.failure(error)
    }
  }

  /** Audits a failed provider call; the provider's own text appears nowhere in the entry. */
  private async auditFailure(scope: SendScope): Promise<void> {
    await own(
      this.audit({
        timestamp: Date.now(),
        tenantId: scope.tenantId,
        channel: 'push',
        verb: 'failed',
        recipient: `devices:${String(scope.tokenCount)}`,
        providerName: this.providerName(),
        errorMessage: 'push provider failed',
        metadata: { tokens: scope.tokenCount },
        ...(scope.userId === undefined ? {} : { userId: scope.userId })
      }),
      OWNER
    )
  }

  /** The error a caller receives for a failed provider call: classified, with no provider text or cause. */
  private failure(error: unknown): NotificationException {
    return new NotificationException(
      'PUSH_SEND_FAILED',
      { providerName: this.providerName() },
      unavailableStatus(error)
    )
  }

  private providerName(): string {
    return readHostName(() => this.provider.name)
  }

  private requireOptions(): NonNullable<ResolvedNotificationOptions['push']> {
    if (!this.options.push) {
      throw new NotificationException('CHANNEL_DISABLED', { channel: 'push' })
    }
    return this.options.push
  }

  /** The audit entry of a send the provider answered. */
  private auditEntry(scope: SendScope, answer: PushSendResult): NotificationLogEntry {
    const { tenantId, userId, tokenCount } = scope
    const failed = answer.results.filter((result) => result.reason !== undefined).length
    return {
      timestamp: Date.now(),
      tenantId,
      channel: 'push',
      verb: failed === tokenCount ? 'failed' : 'sent',
      recipient: `devices:${String(tokenCount)}`,
      providerName: this.providerName(),
      metadata: { tokens: tokenCount, failed },
      ...(userId === undefined ? {} : { userId })
    }
  }

  /** Writes an audit entry, swallowing failures unless `audit.swallowErrors` is `false`. */
  private audit(entry: NotificationLogEntry): Promise<void> {
    return ownChecked(
      writeAudit(
        () => this.auditLog.create(entry),
        this.options.audit.swallowErrors,
        (error) => {
          this.auditWarning.warn(error)
        },
        OWNER
      )
    )
  }
}
