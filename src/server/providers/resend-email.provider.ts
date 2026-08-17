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
import { loadOptionalPeer } from '../utils/load-optional-peer'
import {
  REDACTED_VALUE,
  collectEchoedExcerpts,
  readRedactedMessage,
  redactValues
} from '../utils/redact'

/**
 * Reads the message off an SDK error object, failing closed.
 *
 * The object comes from the SDK, so the property read runs consumer code: a
 * getter that throws a secret-bearing error would escape from the dereference
 * itself, before any withholding decision has been made.
 *
 * @param error - The SDK's `{ message }` error object.
 * @returns Its message, or the redaction marker when the read threw.
 */
function readSdkMessage(error: { message: string }): string {
  try {
    return String(error.message)
  } catch {
    return REDACTED_VALUE
  }
}

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
  #clientPromise: Promise<ResendLike> | null = null

  /**
   * @param options - Adapter options; `apiKey` is required to actually send.
   */
  /**
   * The adapter options, which carry the Resend API key.
   *
   * An ECMAScript private field rather than a TypeScript `private` one: the
   * latter is erased at runtime, leaving an enumerable own property that
   * `JSON.stringify`, object spread and `util.inspect` all walk into. This
   * provider is registered in the container, so anything that renders it
   * incidentally — a structured logger formatting its arguments, an error
   * reporter capturing the scope of a throw — would emit the key in plaintext.
   */
  readonly #options: ResendEmailProviderOptions

  constructor(options: ResendEmailProviderOptions = {}) {
    this.#options = options
  }

  /**
   * Whether an API key was supplied. Does not load the SDK.
   *
   * @returns `true` when an `apiKey` is present.
   */
  isConfigured(): boolean {
    return Boolean(this.#options.apiKey)
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
    let result: ResendSendOutcome
    try {
      result = await client.emails.send({
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
    } catch (error) {
      // The SDK can REJECT instead of resolving `{ error }` — a transport or
      // fetch failure whose message quotes the request body carries the same
      // secrets a quoted rejection does, so it takes the identical exit.
      // Read through the fail-closed helper: coercion runs consumer code, and a
      // hostile `message` getter would otherwise escape with its own text
      // before `sendFailure` could withhold anything.
      throw this.sendFailure(readRedactedMessage(error), options)
    }
    if (result.error) {
      // The SDK's error object is consumer code too, so reading its `message`
      // is guarded rather than dereferenced directly.
      throw this.sendFailure(readSdkMessage(result.error), options)
    }
    if (!result.data?.id) {
      throw new Error('Resend returned no message ID')
    }
    return { messageId: result.data.id }
  }

  /**
   * Builds the failure for a rejected send, logging the scrubbed reason on the
   * way out — the single exit shared by the rejected-promise and `{ error }`
   * result shapes, so neither can surface an unscrubbed message.
   *
   * @param rawMessage - The provider's own error text, unscrubbed.
   * @param options - The send input whose body and declared values to scrub.
   * @returns The `Error` for the caller to throw.
   */
  private sendFailure(rawMessage: string, options: EmailSendOptions): Error {
    if (options.publishProviderText === false) {
      // The body carries a credential, so nothing the API wrote may reach a
      // log line or the thrown message. Unlike SMTP there is no reply code to
      // fall back on here, so the failure publishes only that it happened.
      this.logger.warn('[RESEND_SEND_FAILED] (provider text withheld)')
      return new Error('Resend send failed')
    }
    // Surface only the provider's message — never the email body.
    const reason = this.scrubSendError(rawMessage, options)
    this.logger.warn(`[RESEND_SEND_FAILED] ${reason}`)
    return new Error(`Resend send failed: ${reason}`)
  }

  /**
   * Removes the API key, the caller's declared secrets, and any echoed body
   * excerpt from an SDK error message — the provider cannot know which part of
   * the body is secret, so a detected echo is scrubbed wholesale.
   *
   * @param message - The raw SDK error message.
   * @param options - The send input whose body and declared values to scrub.
   * @returns The message with every known-secret value replaced.
   */
  private scrubSendError(message: string, options: EmailSendOptions): string {
    const values = collectEchoedExcerpts(message, options.html)
    if (options.text !== undefined) {
      values.push(...collectEchoedExcerpts(message, options.text))
    }
    if (options.redactValues) {
      values.push(...options.redactValues)
    }
    // The error path only exists after a successful client init, which requires
    // the key — the filter narrows the type without a dead undefined branch.
    values.push(...[this.#options.apiKey].filter((secret): secret is string => Boolean(secret)))
    return redactValues(message, values)
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
    this.#clientPromise ??= this.createClient()
    return this.#clientPromise
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
      const apiKey = this.#options.apiKey
      if (!apiKey) {
        throw new Error('ResendEmailProvider: missing API key — pass { apiKey } to the constructor')
      }
      const ResendCtor = await this.loadResendConstructor()
      return new ResendCtor(apiKey)
    } catch (error) {
      this.#clientPromise = null
      throw error
    }
  }

  /**
   * Dynamically imports the optional `resend` peer dependency.
   *
   * @returns The SDK's `Resend` constructor.
   * @throws Error When the package is not installed, or — reported as itself rather
   * than as a missing package — when the import fails for any other reason.
   */
  private async loadResendConstructor(): Promise<ResendConstructor> {
    const mod = await loadOptionalPeer<{ Resend: ResendConstructor }>(RESEND_MODULE)
    return mod.Resend
  }
}
