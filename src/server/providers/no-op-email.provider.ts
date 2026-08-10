/**
 * @fileoverview Development email provider that logs instead of sending.
 * @layer infrastructure
 *
 * Useful for local development without SMTP credentials. It logs only a MASKED
 * recipient — never the full address, and never the subject or the body, either
 * of which a consumer template can interpolate an OTP code or other PII into.
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

/**
 * Reduce an email address to a first-initial mask (`m***@example.com`).
 *
 * A recipient is personal data: logging it in clear, even at `debug`, leaves an
 * address in every developer's log for the life of the process. The mask keeps the
 * line useful for correlating a send while dropping the identifying part. An address
 * with no local part before its `@` is masked whole, so a malformed value cannot leak
 * through the branch meant to preserve a first initial.
 *
 * @param address - The recipient address to mask.
 * @returns The masked address.
 */
function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at <= 0) {
    return '***'
  }
  return `${address[0]}***${address.slice(at)}`
}

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
   * Pretends to send: logs a masked recipient and returns a synthetic id.
   *
   * @param options - The message to "send". Only a masked `to` is logged — never
   *   the subject or the body, since a consumer template can interpolate an OTP
   *   code into either.
   * @returns A synthetic `messageId` prefixed with `noop-`.
   */
  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to]
    const masked = recipients.map(maskEmail).join(',')
    this.logger.debug(`[NoOpEmail] to=${masked}`)
    return { messageId: `noop-${randomUUID()}` }
  }
}
