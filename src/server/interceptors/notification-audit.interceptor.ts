/**
 * @fileoverview Opt-in audit interceptor for `NotificationService.dispatch` calls.
 * @layer infrastructure
 *
 * Records one audit entry per intercepted dispatch — `verb: 'sent'` on success,
 * `verb: 'failed'` (with the error message) on rejection, then re-throws. The
 * tenant id is taken from `global.tenantIdResolver(request)` when configured,
 * which OVERRIDES any `tenantId` carried in the dispatch payload — closing the
 * tenant-spoofing vector where a caller forges another tenant's id in the body.
 *
 * The entry NEVER carries the dispatched payload (an OTP `verify` payload holds a
 * guessed code) — only the channel, the masked recipient, the purpose/template,
 * and a fixed `providerName: '__interceptor__'` marker. Audit failures are
 * swallowed by default (`audit.swallowErrors`) so auditing can never crash the
 * request flow; a consumer that sets `swallowErrors: false` opts into propagation.
 *
 * NOT auto-registered — a consumer opts in explicitly, e.g.
 * `{ provide: APP_INTERCEPTOR, useClass: NotificationAuditInterceptor }`.
 */

import { Inject, Injectable } from '@nestjs/common'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { catchError, concatMap, from, map, throwError } from 'rxjs'
import type { Observable } from 'rxjs'

import {
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS
} from '../bymax-notification.constants'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  INotificationLogRepository,
  NotificationLogEntry,
  NotificationLogVerb
} from '../interfaces/notification-log-repository.interface'
import type { NotificationRequest } from '../interfaces/notification-module-options.interface'
import type { DispatchInput } from '../services/notification.service'
import { assertIdentifies } from '../utils/tenant-scope'

/** Marker `providerName` distinguishing interceptor-level entries from service-level ones. */
/** Prefix quoted in guard failures raised by this interceptor. */
// Stryker disable next-line StringLiteral: equivalent — the prefix reaches only `details` and the response message, both of which the cause sanitizer drops before any caller can read them, and every path out of this interceptor wraps the refusal
const INTERCEPTOR_NAME = 'NotificationAuditInterceptor'

const INTERCEPTOR_PROVIDER_NAME = '__interceptor__'

/** Coerces an unknown thrown value into a safe, message-only string. */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Records an audit entry around each `NotificationService.dispatch` call.
 *
 * @example
 * ```ts
 * // app.module.ts
 * providers: [{ provide: APP_INTERCEPTOR, useClass: NotificationAuditInterceptor }]
 * ```
 */
@Injectable()
export class NotificationAuditInterceptor implements NestInterceptor {
  /**
   * @param options - The resolved, frozen module options (carries the tenant resolver + mask).
   * @param auditLog - The audit-log repository (no-op when none configured).
   */
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS)
    private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY)
    private readonly auditLog: INotificationLogRepository
  ) {}

  /**
   * Taps the handler stream: records `'sent'` after a successful dispatch and
   * `'failed'` before re-throwing a rejected one. The success recording runs
   * downstream of the error handler so a failure is audited exactly once.
   *
   * @param context - The execution context exposing the handler arguments + request.
   * @param next - The downstream call handler.
   * @returns The original stream, unchanged except for the audit side effect.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        from(this.recordMeta(context, 'failed', toErrorMessage(error))).pipe(
          concatMap(() => throwError(() => error))
        )
      ),
      concatMap((value) => from(this.recordMeta(context, 'sent')).pipe(map(() => value)))
    )
  }

  /**
   * Builds and writes the audit entry for one intercepted dispatch. Does nothing
   * when no argument matches the dispatch shape. Swallows write failures unless
   * `audit.swallowErrors` is `false`.
   */
  private async recordMeta(
    context: ExecutionContext,
    verb: NotificationLogVerb,
    errorMessage?: string
  ): Promise<void> {
    try {
      const input = this.extractDispatchInput(context)
      if (input === null) {
        return
      }
      const tenantId = await this.resolveTenantId(context, input.tenantId)
      await this.auditLog.create(this.buildEntry(input, tenantId, verb, errorMessage))
    } catch (error) {
      if (!this.options.audit.swallowErrors) {
        // The underlying error rides only on `Error.cause` — `details` is serialized
        // into the HTTP response body, so internal error text must never land there.
        throw new NotificationException('AUDIT_LOG_FAILED', undefined, { cause: error })
      }
    }
  }

  /** Returns the first handler argument shaped like a {@link DispatchInput}, else `null`. */
  private extractDispatchInput(context: ExecutionContext): DispatchInput | null {
    for (const arg of context.getArgs<unknown[]>()) {
      if (this.isDispatchInput(arg)) {
        return arg
      }
    }
    return null
  }

  /** Narrows an unknown argument to a {@link DispatchInput} by structural shape. */
  private isDispatchInput(value: unknown): value is DispatchInput {
    if (typeof value !== 'object' || value === null) {
      return false
    }
    const candidate = value as Record<string, unknown>
    if (candidate.channel !== 'email' && candidate.channel !== 'otp') {
      return false
    }
    if (typeof candidate.tenantId !== 'string') {
      return false
    }
    return typeof candidate.payload === 'object' && candidate.payload !== null
  }

  /**
   * Resolves the trusted tenant id from `tenantIdResolver(request)`.
   *
   * Falls back to the payload-supplied value only when no resolver is configured or
   * no request is available — the payload reaches the handler from the caller, so
   * that value is asserted rather than authenticated, and an entry built from it
   * attributes the event to whichever tenant the caller named. Configure a resolver
   * whenever this interceptor runs on an HTTP boundary.
   *
   * A value that identifies nobody is refused rather than recorded, on BOTH paths:
   * the resolver's answer and the payload fallback. The fallback is the default path
   * — most consumers configure no resolver — so guarding only the resolver would
   * leave the common case unchecked, which is where a blank tenant actually arrives.
   *
   * @throws Error When either the resolved or the fallback tenant id is not a
   *   string, or is blank.
   */
  private async resolveTenantId(context: ExecutionContext, fallback: string): Promise<string> {
    const resolver = this.options.global.tenantIdResolver
    if (resolver === undefined) {
      // Stryker disable next-line StringLiteral: equivalent — the label reaches only `details` and the response message, both of which live on `response` and are dropped by the cause sanitizer; every path out of this interceptor wraps the refusal, so no test of the public surface can observe which label was passed
      assertIdentifies(INTERCEPTOR_NAME, 'the payload tenant id', fallback)
      return fallback
    }
    const request = this.extractRequest(context)
    if (request === null) {
      // Stryker disable next-line StringLiteral: equivalent — the label reaches only `details` and the response message, both of which live on `response` and are dropped by the cause sanitizer; every path out of this interceptor wraps the refusal, so no test of the public surface can observe which label was passed
      assertIdentifies(INTERCEPTOR_NAME, 'the payload tenant id', fallback)
      return fallback
    }
    const resolved = await resolver(request)
    // Stryker disable next-line StringLiteral: equivalent — the label reaches only `details` and the response message, both of which live on `response` and are dropped by the cause sanitizer; every path out of this interceptor wraps the refusal, so no test of the public surface can observe which label was passed
    assertIdentifies(INTERCEPTOR_NAME, 'the resolved tenant id', resolved)
    return resolved
  }

  /** Reads the HTTP request from the context, returning `null` outside an HTTP context. */
  private extractRequest(context: ExecutionContext): NotificationRequest | null {
    try {
      return context.switchToHttp().getRequest<NotificationRequest | undefined>() ?? null
    } catch {
      return null
    }
  }

  /** Assembles the audit entry — masked recipient, never the dispatched payload. */
  private buildEntry(
    input: DispatchInput,
    tenantId: string,
    verb: NotificationLogVerb,
    errorMessage: string | undefined
  ): NotificationLogEntry {
    const purpose = this.extractPurpose(input)
    return {
      timestamp: Date.now(),
      tenantId,
      channel: input.channel,
      verb,
      recipient: this.options.audit.maskRecipient(this.extractRecipient(input)),
      providerName: INTERCEPTOR_PROVIDER_NAME,
      metadata: { interceptedBy: 'NotificationAuditInterceptor' },
      ...(purpose !== undefined ? { purpose } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {})
    }
  }

  /** Extracts the (unmasked) recipient from the dispatch payload. */
  private extractRecipient(input: DispatchInput): string {
    if (input.channel === 'email') {
      return Array.isArray(input.payload.to) ? (input.payload.to[0] ?? '') : input.payload.to
    }
    return input.payload.recipient
  }

  /** Extracts the audit `purpose`: the OTP purpose, or the email template name. */
  private extractPurpose(input: DispatchInput): string | undefined {
    return input.channel === 'otp' ? input.payload.purpose : input.payload.template
  }
}
