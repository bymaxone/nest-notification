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
import { errorCodeOf } from '../utils/availability'
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

/**
 * Settles with `call`, or rejects as soon as `signal` aborts, whichever comes first. The SDK is
 * also handed the signal, but an older SDK ignores it, and this keeps the bound on every supported
 * version. The abort listener is removed when the call settles, so a send that answers in time
 * leaves nothing waiting on the timer, and a call that settles later is still handled.
 *
 * @param call - The SDK call.
 * @param signal - The signal whose abort ends the wait.
 * @returns What `call` resolves with.
 */
function settleOrAbort<T>(call: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    call.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/**
 * Marks the error a provider throws with a failure code, when there is one, so the status of the
 * failure can be read off the code and not off the provider's words.
 */
function withCode(error: Error, code: string | undefined): Error {
  return code === undefined ? error : Object.assign(error, { code })
}

/**
 * `EUNAVAILABLE` for an error object the SDK returned that says Resend could not be reached or is
 * down: no request was made at all (the SDK's `application_error` with no status), or an HTTP 5xx.
 * Anything else, a rejected request included, is an answer and carries no availability code.
 */
function unavailableCodeOf(error: { name?: unknown; statusCode?: unknown }): string | undefined {
  try {
    const status: unknown = error.statusCode
    const requestNotMade = error.name === 'application_error' && status === null
    return requestNotMade || (typeof status === 'number' && status >= 500)
      ? 'EUNAVAILABLE'
      : undefined
  } catch {
    return undefined
  }
}

/** Default bound on one send, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Largest bound a timer can hold: past 2^31 - 1 milliseconds Node clamps the duration to 1 ms and
 * the call aborts at once, so such a value is refused instead of accepted.
 */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Construction options for {@link ResendEmailProvider}. */
export interface ResendEmailProviderOptions {
  /** Resend API key. When absent the provider is not configured and `send()` throws. */
  apiKey?: string
  /**
   * Longest one `send()` may take, in milliseconds, from the request to the end of the response
   * body. An integer from `1` to `2147483647`; default `15000`. A send that exceeds it fails with
   * `EMAIL_SEND_FAILED`. The message may still have been accepted by Resend: only the answer is
   * missing, so the failure does not say the message was not sent.
   */
  timeoutMs?: number
}

/** Outcome of `resend.emails.send` — a `{ data, error }` discriminated result. */
interface ResendSendOutcome {
  data: { id: string } | null
  error: { message: string; name?: unknown; statusCode?: unknown } | null
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

/** The request options of the SDK this adapter uses: the signal that aborts the call. */
interface ResendRequestOptions {
  signal: AbortSignal
}

/** The slim surface of the `resend` SDK this adapter relies on. */
interface ResendLike {
  emails: {
    send(payload: ResendSendPayload, options: ResendRequestOptions): Promise<ResendSendOutcome>
  }
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
    const timeout = options.timeoutMs
    if (
      timeout !== undefined &&
      !(Number.isInteger(timeout) && timeout >= 1 && timeout <= MAX_TIMEOUT_MS)
    ) {
      throw new Error(
        `ResendEmailProvider: timeoutMs must be a positive integer of at most ${String(MAX_TIMEOUT_MS)}`
      )
    }
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
    const timeoutMs = this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const signal = AbortSignal.timeout(timeoutMs)
    let result: ResendSendOutcome
    try {
      result = await settleOrAbort(
        client.emails.send(
          {
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
          },
          { signal }
        ),
        signal
      )
    } catch (error) {
      // The SDK can REJECT instead of resolving `{ error }` — a transport or
      // fetch failure whose message quotes the request body carries the same
      // secrets a quoted rejection does, so it takes the identical exit.
      // Read through the fail-closed helper: coercion runs consumer code, and a
      // hostile `message` getter would otherwise escape with its own text
      // before `sendFailure` could withhold anything.
      // The bound fired: the SDK's own abort error and the race's mean the same thing, and neither
      // carries anything of the request, so the reason is a fixed sentence.
      const reason = signal.aborted
        ? `Resend request timed out after ${String(timeoutMs)} ms`
        : readRedactedMessage(error)
      throw this.sendFailure(reason, options, signal.aborted ? 'ETIMEDOUT' : errorCodeOf(error))
    }
    if (result.error) {
      // The SDK's error object is consumer code too, so reading its `message`
      // is guarded rather than dereferenced directly.
      throw this.sendFailure(readSdkMessage(result.error), options, unavailableCodeOf(result.error))
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
  private sendFailure(rawMessage: string, options: EmailSendOptions, code?: string): Error {
    if (options.publishProviderText === false) {
      // The body carries a credential, so nothing the API wrote may reach a
      // log line or the thrown message. Unlike SMTP there is no reply code to
      // fall back on here, so the failure publishes only that it happened.
      this.logger.warn('[RESEND_SEND_FAILED] (provider text withheld)')
      return withCode(new Error('Resend send failed'), code)
    }
    // Surface only the provider's message — never the email body.
    const reason = this.scrubSendError(rawMessage, options)
    this.logger.warn(`[RESEND_SEND_FAILED] ${reason}`)
    return withCode(new Error(`Resend send failed: ${reason}`), code)
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
