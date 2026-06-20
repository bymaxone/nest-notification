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
  /**
   * Cached in-flight (or resolved) SDK client initialization. `null` until the first
   * `send()` and after a failed init. Caching the PROMISE (not just the client)
   * collapses concurrent first sends onto a single dynamic `import()` + instantiation;
   * a failed init resets this back to `null` so a transient error can be retried.
   */
  private clientPromise: Promise<ResendLike> | null = null

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
    const from = this.formatFrom(options.from, options.fromName)
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
   * Formats the RFC-5322 `from` header. The `Name <address>` display-name form is
   * only used when a non-empty address exists — otherwise it would emit the literal
   * `Name <undefined>` / `Name <>`. Falls back to the bare address (or `''`).
   *
   * @param from - The sender address, if any.
   * @param fromName - The sender display name, if any.
   * @returns `"Name <address>"`, the bare address, or `''`.
   */
  private formatFrom(from: string | undefined, fromName: string | undefined): string {
    const address = from ?? ''
    if (fromName && address) {
      return `${fromName} <${address}>`
    }
    return address
  }

  /**
   * Returns the cached SDK client, lazily importing `resend` on first use. Concurrent
   * first calls share one in-flight initialization promise so the dynamic import and
   * constructor run exactly once; a failed init is dropped from the cache so a later
   * call can retry instead of being permanently bricked.
   *
   * @returns The instantiated client.
   * @throws Error When `apiKey` is missing or the `resend` package is not installed.
   */
  private getClient(): Promise<ResendLike> {
    this.clientPromise ??= this.createClient()
    return this.clientPromise
  }

  /**
   * Builds a fresh SDK client, resetting the cached promise on any failure so the
   * provider is not permanently bricked by a transient init error.
   *
   * @returns The instantiated client.
   * @throws Error When `apiKey` is missing or the `resend` package is not installed.
   */
  private async createClient(): Promise<ResendLike> {
    try {
      const apiKey = this.options.apiKey
      if (!apiKey) {
        throw new Error('ResendEmailProvider: missing API key — pass { apiKey } to the constructor')
      }
      const ResendCtor = await this.loadResendConstructor()
      return new ResendCtor(apiKey)
    } catch (error) {
      this.clientPromise = null
      throw error
    }
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
