/**
 * @fileoverview Reference `IEmailProvider` adapter backed by the Resend SDK.
 * @layer infrastructure
 *
 * `resend` is an OPTIONAL peer dependency: the SDK is loaded lazily via a dynamic
 * `import()` the first time `send()` runs, so a consumer who picks a different
 * provider never has to install it. The adapter forward-declares the slim
 * `ResendLike` shape it needs instead of importing `resend` at compile time,
 * keeping the library free of a hard dependency on the SDK's types.
 *
 * Security: the email body (`html` / `text`) may carry OTP codes or PII — it is
 * NEVER logged. Only the provider's own error message is surfaced (and re-thrown
 * as a plain `Error`, which `EmailService` maps to `EMAIL_SEND_FAILED`).
 */

import { Injectable, Logger } from '@nestjs/common'

import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'

/** Construction options for {@link ResendEmailProvider}. */
export interface ResendEmailProviderOptions {
  /** Resend API key. When absent the provider is not configured and `send()` throws. */
  apiKey?: string
}

/** Outcome of `resend.emails.send` — a `{ data, error }` discriminated result. */
interface ResendSendOutcome {
  data: { id: string } | null
  error: { message: string } | null
}

/** The exact payload subset {@link ResendEmailProvider} forwards to the SDK. */
interface ResendSendPayload {
  from: string
  to: string | string[]
  subject: string
  html: string
  text: string | undefined
  replyTo: string | undefined
  cc: string | string[] | undefined
  bcc: string | string[] | undefined
  tags: ReadonlyArray<{ name: string; value: string }> | undefined
  headers: Record<string, string> | undefined
  attachments: EmailSendOptions['attachments']
}

/** The slim surface of the `resend` SDK this adapter relies on. */
interface ResendLike {
  emails: { send(payload: ResendSendPayload): Promise<ResendSendOutcome> }
}

/** Constructor signature of the SDK's `Resend` class. */
type ResendConstructor = new (apiKey: string) => ResendLike

/**
 * Module specifier kept in a `string`-typed constant so the compiler treats the
 * dynamic `import()` as runtime-resolved — `resend` is an optional peer dep that
 * may be absent at build time, and a literal specifier would fail type-checking.
 */
const RESEND_MODULE: string = 'resend'

/**
 * Reference {@link IEmailProvider} on top of Resend.
 *
 * @example
 * ```ts
 * BymaxNotificationModule.forRoot({
 *   email: { provider: new ResendEmailProvider({ apiKey }), defaultFrom: 'noreply@acme.com' }
 * })
 * ```
 */
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  readonly name = 'resend'
  private readonly logger = new Logger(ResendEmailProvider.name)
  /** Lazily instantiated SDK client; `null` until the first `send()`. */
  private client: ResendLike | null = null

  /**
   * @param options - Adapter options; `apiKey` is required to actually send.
   */
  constructor(private readonly options: ResendEmailProviderOptions = {}) {}

  /**
   * Whether an API key was supplied. Does not load the SDK.
   *
   * @returns `true` when an `apiKey` is present.
   */
  isConfigured(): boolean {
    return Boolean(this.options.apiKey)
  }

  /**
   * Sends one transactional email through Resend.
   *
   * @param options - The message envelope and body.
   * @returns The Resend message id.
   * @throws Error When the API key is missing, the `resend` package is not
   * installed, the SDK returns an error, or no message id comes back. `EmailService`
   * maps any thrown `Error` to `EMAIL_SEND_FAILED`.
   */
  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const client = await this.getClient()
    const from = options.fromName ? `${options.fromName} <${options.from}>` : (options.from ?? '')
    const result = await client.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      tags: options.tags,
      headers: options.headers,
      attachments: options.attachments
    })
    if (result.error) {
      // Surface only the provider's message — never the email body.
      this.logger.warn(`[RESEND_SEND_FAILED] ${result.error.message}`)
      throw new Error(`Resend send failed: ${result.error.message}`)
    }
    if (!result.data?.id) {
      throw new Error('Resend returned no message ID')
    }
    return { messageId: result.data.id }
  }

  /**
   * Returns the cached SDK client, lazily importing `resend` on first use.
   *
   * @returns The instantiated client.
   * @throws Error When `apiKey` is missing or the `resend` package is not installed.
   */
  private async getClient(): Promise<ResendLike> {
    if (this.client) {
      return this.client
    }
    if (!this.options.apiKey) {
      throw new Error('ResendEmailProvider: missing API key — pass { apiKey } to the constructor')
    }
    const ResendCtor = await this.loadResendConstructor()
    this.client = new ResendCtor(this.options.apiKey)
    return this.client
  }

  /**
   * Dynamically imports the optional `resend` peer dependency.
   *
   * @returns The SDK's `Resend` constructor.
   * @throws Error When the package is not installed in the consumer app.
   */
  private async loadResendConstructor(): Promise<ResendConstructor> {
    try {
      const mod = (await import(RESEND_MODULE)) as { Resend: ResendConstructor }
      return mod.Resend
    } catch {
      throw new Error(
        '`resend` package is not installed. Run `pnpm add resend` in the consumer app.'
      )
    }
  }
}
