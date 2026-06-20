/**
 * @fileoverview Development email provider that logs instead of sending.
 * @layer infrastructure
 *
 * Useful for local development without SMTP credentials. It logs only the
 * recipient and subject — NEVER the body, which may carry OTP codes or PII.
 *
 * DO NOT USE IN PRODUCTION.
 */

import { randomUUID } from 'node:crypto'

import { Injectable, Logger } from '@nestjs/common'

import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'

/** No-op `IEmailProvider` for development and tests. */
@Injectable()
export class NoOpEmailProvider implements IEmailProvider {
  readonly name = 'noop'
  private readonly logger = new Logger(NoOpEmailProvider.name)

  /** Always ready — the no-op provider has nothing to configure. */
  isConfigured(): boolean {
    return true
  }

  /**
   * Pretends to send: logs the recipient and subject and returns a synthetic id.
   *
   * @param options - The message to "send". Only `to` and `subject` are logged.
   * @returns A synthetic `messageId` prefixed with `noop-`.
   */
  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const to = Array.isArray(options.to) ? options.to.join(',') : options.to
    this.logger.debug(`[NoOpEmail] to=${to} subject="${options.subject}"`)
    return { messageId: `noop-${randomUUID()}` }
  }
}
