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

/** Marker `providerName` distinguishing interceptor-level entries from service-level ones. */
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
        throw new NotificationException('AUDIT_LOG_FAILED', { cause: toErrorMessage(error) })
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
   * Resolves the trusted tenant id: `tenantIdResolver(request)` when configured and
   * a request is available, otherwise the payload-supplied `fallback`.
   */
  private async resolveTenantId(context: ExecutionContext, fallback: string): Promise<string> {
    const resolver = this.options.global.tenantIdResolver
    if (resolver === undefined) {
      return fallback
    }
    const request = this.extractRequest(context)
    if (request === null) {
      return fallback
    }
    return resolver(request)
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
