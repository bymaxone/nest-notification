/**
 * @fileoverview Reference `IEmailProvider` adapter speaking SMTP through Nodemailer.
 * @layer infrastructure
 *
 * SMTP is the protocol every relay, Postfix, corporate gateway, SES-via-SMTP and
 * mail-capture server (Mailpit, MailHog) understands, so this adapter serves both
 * production delivery and the end-to-end tests a consumer needs to exercise its
 * email flows.
 *
 * `nodemailer` is an OPTIONAL peer dependency: it is loaded lazily via a dynamic
 * `import()` the first time `send()` runs, so a consumer who picks a different
 * transport never has to install it. The adapter forward-declares the slim shape it
 * needs instead of importing `nodemailer` at compile time, keeping the library free
 * of a hard dependency on its types.
 *
 * Security: the email body (`html` / `text`) may carry OTP codes or PII — it is
 * NEVER logged. The SMTP password is held in an ECMAScript private field so it
 * cannot be walked by a serializer, and is scrubbed from any transport error before
 * that error is logged or re-thrown.
 */

import { Injectable, Logger } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'

import { NOTIFICATION_LOG_EVENTS } from '../constants/log-events.constants'
import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'
import { errorCodeOf } from '../utils/availability'
import { extractDeliveryStatus, withoutDeclaredValues } from '../utils/delivery-status'
import { describeError, UNPRINTABLE_ERROR } from '../utils/describe-error'
import { assertBodyParts } from '../utils/email-body'
import { loadOptionalPeer } from '../utils/load-optional-peer'
import { logEvent } from '../utils/log-event'
import { codeWithoutSecrets } from '../utils/masked-failure'
import { assertPort } from '../utils/port-option'
import { publishedFailure } from '../utils/provider-failure'
import { rethrowRefusal } from '../utils/provider-refusal'
import { readSendOptions } from '../utils/provider-send-options'
import { nullProto, readName, withOwnKeys } from '../utils/read-options'
import { assertStandardRealmRoot, boxed, checkedAwait, newPromise, own } from '../utils/realm-root'
import type { Boxed } from '../utils/realm-root'
import {
  collectEchoedExcerpts,
  isSafeError,
  readRedactedMessage,
  redactValues
} from '../utils/redact'
import { assertTimerMs } from '../utils/timer-option'
import { AUTH_KEYS, MESSAGE_KEYS } from './nodemailer-keys'
import { mapSmtpAttachments } from './smtp-attachments'
import { shadowTransportAuth } from './smtp-auth-shadow'
import type {
  NodemailerLike,
  SmtpCredentials,
  SmtpEmailProviderOptions,
  SmtpPoolOptions,
  SmtpSendPayload,
  SmtpSender,
  SmtpTransportConfig,
  SmtpTransportLike
} from './smtp-email.types'
import { ownBody, ownRecipients } from './smtp-message-parts'
import { readPool, readSmtpOptions } from './smtp-options'
import { relayRefused } from './smtp-relay-refused'
import { buildSmtpTransportConfig } from './smtp-transport-config'
export type {
  SmtpCredentials,
  SmtpEmailProviderOptions,
  SmtpPoolOptions,
  SmtpTlsKeyEntry,
  SmtpTlsOptions,
  SmtpTlsPfxEntry
} from './smtp-email.types'

/** Default bound on one whole send, in milliseconds. */
const DEFAULT_SEND_TIMEOUT_MS = 60_000

/** Clears the timer; a `clearTimeout` that throws must not end the bookkeeping in a rejection nobody handles. */
function releaseTimer(timer: NodeJS.Timeout): void {
  try {
    clearTimeout(timer)
  } catch {
    // The timer fires into a settled promise, which ignores it.
  }
}

/**
 * Settles with `call`, or rejects once `timeoutMs` has passed, whichever comes first. Nodemailer
 * cannot abort a send in flight, so only the caller stops waiting: the outcome of `call` after that
 * is still observed here, so a late rejection is never unhandled. The timer is cleared when `call`
 * settles, so a send that answers in time leaves nothing armed.
 *
 * @param call - The transport's send.
 * @param timeoutMs - The longest to wait, in milliseconds.
 * @returns What `call` resolves with, boxed: resolving with the transport's own object would read its `then`.
 */
function settleOrTimeout<T>(call: Promise<T>, timeoutMs: number): Promise<Boxed<T>> {
  return newPromise<Boxed<T>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`SMTP send timed out after ${String(timeoutMs)} ms`), {
          code: 'ETIMEDOUT'
        })
      )
    }, timeoutMs)
    // Awaited pinned, not through then/finally: those read `Promise[Symbol.species]`.
    void (async (): Promise<void> => {
      try {
        resolve(boxed(await own(call, 'SmtpEmailProvider')))
      } catch (error) {
        reject(error)
      } finally {
        releaseTimer(timer)
      }
    })()
  })
}

/**
 * Whether both halves of a credential pair are present.
 *
 * A type predicate so the caller can hand the narrowed pair to the transport
 * without re-asserting it — the completeness rule then lives in exactly one place,
 * shared by `isConfigured()` and the transport build.
 *
 * @param credentials - The credentials to check.
 * @returns `true` when `user` and `pass` are both non-empty.
 */
function areCredentialsComplete(
  credentials: SmtpCredentials
): credentials is { user: string; pass: string } {
  return Boolean(credentials.user) && Boolean(credentials.pass)
}

/**
 * Module specifier kept in a `string`-typed constant so the compiler treats the
 * dynamic `import()` as runtime-resolved — `nodemailer` is an optional peer dep
 * that may be absent at build time, and a literal specifier would fail type-checking.
 */
const NODEMAILER_MODULE: string = 'nodemailer'

/**
 * Reference {@link IEmailProvider} speaking SMTP.
 *
 * @example Local capture server (Mailpit / MailHog)
 * ```ts
 * new SmtpEmailProvider({ host: 'localhost', port: 1025, secure: false })
 * ```
 *
 * @example Authenticated production relay
 * ```ts
 * BymaxNotificationModule.forRoot({
 *   email: {
 *     provider: new SmtpEmailProvider({
 *       host: process.env.SMTP_HOST,
 *       port: 587,
 *       requireTls: true,
 *       credentials: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
 *     }),
 *     defaultFrom: 'noreply@acme.com'
 *   }
 * })
 * ```
 *
 * @remarks `EmailSendOptions.tags` are not forwarded: SMTP has no tag facility.
 * They still reach the audit log through `EmailService`.
 */
@Injectable()
export class SmtpEmailProvider implements IEmailProvider, OnModuleDestroy {
  readonly name = 'smtp'
  private readonly logger = new Logger(SmtpEmailProvider.name)
  /**
   * Cached in-flight (or resolved) transport initialization. `null` until the first
   * `send()` and after a failed init. Caching the PROMISE (not just the transport)
   * collapses concurrent first sends onto a single dynamic `import()` + creation;
   * a failed init resets this back to `null` so a transient error can be retried.
   */
  #transportPromise: Promise<Boxed<SmtpTransportLike>> | null = null

  /**
   * The adapter options, which carry the SMTP password.
   *
   * An ECMAScript private field rather than a TypeScript `private` one: the latter
   * is erased at runtime, leaving an enumerable own property that `JSON.stringify`,
   * object spread and `util.inspect` all walk into. This provider is registered in
   * the container, so anything that renders it incidentally — a structured logger
   * formatting its arguments, an error reporter capturing the scope of a throw —
   * would emit the password in plaintext.
   */
  readonly #options: SmtpEmailProviderOptions

  /** The limits of the pool option, read once at construction; `undefined` for an unpooled transport. */
  readonly #pool: SmtpPoolOptions | undefined

  /**
   * @param options - Adapter options; `host` is required to actually send, and
   *   `credentials` must be complete whenever supplied at all.
   * @throws Error When `sendTimeoutMs` is not an integer from `1` to `2147483647`.
   */
  constructor(options: SmtpEmailProviderOptions = {}) {
    // A copy first, so every check below reads the values that are kept, once.
    assertStandardRealmRoot('SmtpEmailProvider')
    const own = readSmtpOptions(options)
    assertPort('SmtpEmailProvider', own.port)
    for (const [name, value] of [
      ['sendTimeoutMs', own.sendTimeoutMs],
      ['connectionTimeout', own.connectionTimeout],
      ['greetingTimeout', own.greetingTimeout],
      ['socketTimeout', own.socketTimeout]
    ] as const) {
      assertTimerMs('SmtpEmailProvider', name, value)
    }
    this.#pool = readPool(own.pool)
    this.#options = own
  }

  /**
   * Whether the relay is fully described. Does not open a connection nor load
   * Nodemailer.
   *
   * A host is always required. Credentials are required only when the consumer
   * supplied a `credentials` object at all — which is how a deployment declares that
   * it logs in. That makes an open capture server configured, while a production
   * relay whose `SMTP_PASS` variable failed to load is *not*, instead of silently
   * attempting an anonymous send.
   *
   * @returns `true` when the provider can attempt a send.
   */
  isConfigured(): boolean {
    if (!this.#options.host) {
      return false
    }
    const credentials = this.#options.credentials
    if (credentials === undefined) {
      return true
    }
    return areCredentialsComplete(credentials)
  }

  /**
   * Sends one transactional email over SMTP.
   *
   * @param options - The message envelope and body.
   * @returns The RFC-5322 `Message-ID` assigned to the message, angle brackets
   *   included — the value that also appears in the delivered message's headers,
   *   so an audit entry correlates with what the recipient received.
   * @throws Error When an address or custom header carries a line break, the
   * configuration is incomplete, no sender address is available, the `nodemailer`
   * package is not installed, the transport rejects the message, or no message id
   * comes back. `EmailService` maps any thrown `Error` to `EMAIL_SEND_FAILED`.
   */
  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const sent = await own(this.sendRead(readSendOptions(options)), 'SmtpEmailProvider')
    assertStandardRealmRoot('SmtpEmailProvider')
    return sent
  }

  /** Sends a message already read by name, whose fields no key planted on the realm root can answer for. */
  private async sendRead(options: EmailSendOptions): Promise<EmailSendResult> {
    assertBodyParts(options.html, options.text)
    assertStandardRealmRoot('SmtpEmailProvider')
    this.guardHeaderInjection(options)
    const from = this.buildSender(options.from, options.fromName)
    const transport = (await own(this.getTransport(), 'SmtpEmailProvider')).value
    const dispatched = this.dispatch(
      transport,
      // No prototype: nodemailer reads keys this adapter never sets (`envelope`, `raw`, `list`,
      // `alternatives`...), and a key planted on the realm root must not answer for them.
      withOwnKeys(
        {
          from,
          to: ownRecipients(options.to),
          subject: options.subject,
          html: ownBody(options.html as string | undefined),
          text: ownBody(options.text),
          replyTo: ownRecipients(options.replyTo),
          cc: ownRecipients(options.cc),
          bcc: ownRecipients(options.bcc),
          headers: options.headers,
          attachments: mapSmtpAttachments(options.attachments),
          disableFileAccess: true,
          disableUrlAccess: true
        },
        MESSAGE_KEYS
      ),
      options.redactValues,
      options.publishProviderText
    )
    const info = await own(dispatched, 'SmtpEmailProvider')
    const messageId = info.messageId
    if (!messageId) {
      throw new Error('SMTP transport returned no message ID')
    }
    // The host's getter ran above: the realm is checked again before the answer is built.
    assertStandardRealmRoot('SmtpEmailProvider')
    return { messageId }
  }

  /**
   * Checks that the relay answers, without sending a message: the transport connects, reads the
   * greeting, upgrades to TLS when the options ask for it, and logs in when credentials are set.
   * Meant for a readiness check, which should call it rarely and bound it with a timeout.
   *
   * The failure carries no text of the relay's or of Nodemailer's, which can quote the options, so
   * what it reports is the same words every time.
   *
   * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when `Object.prototype` holds a non-standard
   *   key, before the transport is built and again before it connects.
   * @throws Error `SmtpEmailProvider: the relay did not accept the connection`, whatever the cause.
   */
  async verify(): Promise<void> {
    assertStandardRealmRoot('SmtpEmailProvider')
    let transport: SmtpTransportLike
    try {
      transport = (await own(this.transportToVerify(), 'SmtpEmailProvider')).value
    } catch {
      relayRefused()
    }
    // Again before the connection, with nothing between it and the call, and outside the wrap.
    assertStandardRealmRoot('SmtpEmailProvider')
    try {
      await checkedAwait(transport.verify?.() as Promise<unknown>, 'SmtpEmailProvider')
    } catch {
      relayRefused()
    }
  }

  /**
   * Closes the transport this provider built, so a pooled connection does not keep the process
   * alive. A send already in flight on a pooled transport finishes; one still waiting for a
   * connection fails with `Connection pool was closed`. Idempotent, and it never builds a transport
   * to close it. A `send()` after it builds a new transport, which the host has to close again if it
   * keeps the provider alive.
   *
   * A close that throws is logged as a fixed line and not rethrown, so one failure cannot stop the
   * other shutdown hooks of the application.
   */
  async close(): Promise<void> {
    const pending = this.#transportPromise
    this.#transportPromise = null
    if (pending === null) {
      return
    }
    let transport: SmtpTransportLike
    try {
      transport = (await own(pending, 'SmtpEmailProvider')).value
    } catch {
      return
    }
    try {
      transport.close?.()
    } catch {
      // What the failure carries can hold the relay's words or a credential: log a fixed line only.
      logEvent(
        this.logger,
        'warn',
        NOTIFICATION_LOG_EVENTS.SMTP_CLOSE_FAILED,
        '[SMTP_CLOSE_FAILED] The transport could not be closed.'
      )
    }
  }

  /** Nest calls this when the application closes; it closes the transport. */
  async onModuleDestroy(): Promise<void> {
    await own(this.close(), 'SmtpEmailProvider')
  }

  /**
   * Hands the payload to the transport, converting a transport failure into a plain
   * `Error` whose message has the SMTP password scrubbed out. The email body is
   * never part of what is logged.
   *
   * @param transport - The initialized transport.
   * @param payload - The message to send.
   * @returns The transport's send info.
   * @throws Error When the transport rejects the message.
   */
  private async dispatch(
    transport: SmtpTransportLike,
    payload: SmtpSendPayload,
    redactValuesList?: readonly string[],
    publishProviderText?: boolean
  ): Promise<{ messageId?: string }> {
    // Checked again where the message is handed over, after the transport was created.
    assertStandardRealmRoot('SmtpEmailProvider')
    try {
      // Pinned and checked: the box of the transport's answer is awaited on a realm that was checked.
      const settled = await checkedAwait(
        settleOrTimeout(
          transport.sendMail(payload),
          this.#options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS
        ),
        'SmtpEmailProvider'
      )
      // Last before the return, which reads `then` of what it resolves with.
      assertStandardRealmRoot('SmtpEmailProvider')
      return settled.value
    } catch (error) {
      // A send that failed while the realm root is polluted failed because of it (the socket destroys
      // the connection on a write then), and is told so: the refusal, not the relay's error.
      assertStandardRealmRoot('SmtpEmailProvider')
      rethrowRefusal(error, 'EmailService')
      throw this.failure(error, payload, redactValuesList, publishProviderText)
    }
  }

  /** Builds the error this adapter throws for a transport failure, logging the scrubbed reason. */
  private failure(
    error: unknown,
    payload: SmtpSendPayload,
    redactValuesList: readonly string[] | undefined,
    publishProviderText: boolean | undefined
  ): Error {
    // Credentials, declared secrets and echoed body excerpts are removed in
    // ONE pass over the raw message — a policy/DLP relay that quotes the
    // rejected content puts the body (and any secret inside it) into the
    // error text this line is about to log.
    // Read through the fail-closed helper: coercing a hostile rejection runs
    // consumer code, and a `message` getter that throws a secret-bearing
    // error would otherwise escape from here — before the branch below has
    // had a chance to withhold anything.
    const raw = readRedactedMessage(error)
    // The client's own error code (a refused connection, a timeout) crosses to the error this
    // adapter throws: it is a token, and the status of the failure is read from it.
    const code = codeWithoutSecrets(errorCodeOf(error), redactValuesList)
    if (publishProviderText === false) {
      return this.withheldFailure(raw, code, redactValuesList)
    }
    const reason = this.scrubTransportError(raw, payload, redactValuesList)
    return publishedFailure(
      this.logger,
      NOTIFICATION_LOG_EVENTS.SMTP_SEND_FAILED,
      '[SMTP_SEND_FAILED] The send failed; the relay error is in the err field.',
      'SMTP',
      reason,
      code
    )
  }

  /**
   * The failure of a send whose body carries a credential: none of the relay's own words may reach a
   * log line or a thrown message — redaction removes the shapes it predicts and a re-encoded echo
   * defeats it. Only the reply codes a fixed grammar can express are published, and they are the
   * same whatever the body held.
   *
   * Filtered HERE, not only in EmailService: this adapter is public, and its own warn line would
   * otherwise write a code that contains the caller's declared secret — an OTP of `55` sits inside a
   * `550` reply.
   */
  private withheldFailure(
    raw: string,
    code: string | undefined,
    redactValuesList: readonly string[] | undefined
  ): Error {
    const { status, enhanced } = withoutDeclaredValues(extractDeliveryStatus(raw), redactValuesList)
    const codes = [status, enhanced].filter((reply) => reply !== undefined).join(' ')
    logEvent(
      this.logger,
      'warn',
      NOTIFICATION_LOG_EVENTS.SMTP_SEND_FAILED,
      `[SMTP_SEND_FAILED] ${codes || 'no reply code'}`
    )
    // The codes ride on the thrown error rather than in its message: the message is a fixed label, so
    // `EmailService` could not recover them by parsing it, and interpolating them would put digits
    // back into a string a log rule then has to scan.
    return Object.assign(new Error('SMTP send failed'), {
      ...(status !== undefined ? { deliveryStatus: status } : {}),
      ...(enhanced !== undefined ? { deliveryEnhancedStatus: enhanced } : {}),
      ...(code !== undefined ? { code } : {})
    })
  }

  /**
   * Removes the credentials, the caller's declared secrets and any echoed body
   * excerpt from a transport error's text — the credential scrub alone cannot
   * cover content the provider does not know is secret.
   *
   * Echo detection runs against the RAW message and every value is replaced in
   * a single pass. Redacting credentials first would break a contiguous body
   * run that happens to quote one, dropping the surviving halves below the
   * detection window and leaving the rest of that body — and any secret inside
   * it — in the log line.
   *
   * @param message - The raw transport error message.
   * @param payload - The message that was sent, whose body is the echo reference.
   * @param declaredValues - The caller's declared secrets, if any.
   * @returns The message with every known-secret value replaced.
   */
  private scrubTransportError(
    message: string,
    payload: SmtpSendPayload,
    declaredValues: readonly string[] | undefined
  ): string {
    const values = collectEchoedExcerpts(message, payload.html?.content)
    values.push(...collectEchoedExcerpts(message, payload.text?.content))
    if (declaredValues) {
      values.push(...declaredValues)
    }
    values.push(...this.credentialValues())
    return redactValues(message, values)
  }

  /**
   * The passphrases the TLS options carry, which a transport error that quotes the options would
   * show: the one on `tls`, and those of the `key` and `pfx` entries that bring their own.
   *
   * @returns Each passphrase that is a string, as given (an empty one is skipped by the redaction).
   */
  private tlsPassphrases(): string[] {
    const tls = this.#options.tls as unknown
    if (typeof tls !== 'object' || tls === null) {
      return []
    }
    const carriers = [readName(tls, 'key'), readName(tls, 'pfx')].flat() as unknown[]
    const found = [
      readName(tls, 'passphrase'),
      ...carriers.map((entry) =>
        typeof entry === 'object' && entry !== null ? readName(entry, 'passphrase') : undefined
      )
    ]
    return found.filter((value): value is string => typeof value === 'string')
  }

  /**
   * The configured credentials that qualify as secret material, if any, and the base64 forms the
   * AUTH exchange carries them in: the user and the password as AUTH LOGIN sends them, and the
   * AUTH PLAIN token, which has an empty authorization identity. A relay that quotes the exchange
   * shows those, and a literal match cannot see them. The token is its own value: base64 groups
   * three bytes, so the token's bytes usually sit at another alignment than the user's or the
   * password's, and then neither of their encodings appears inside it. It cannot be derived from
   * them.
   */
  private credentialValues(): string[] {
    const credentials = this.#options.credentials
    const user = credentials === undefined ? undefined : readName(credentials, 'user')
    const pass = credentials === undefined ? undefined : readName(credentials, 'pass')
    const secrets = [user, pass].filter((secret): secret is string => Boolean(secret))
    const plainToken = `\u0000${secrets.join('\u0000')}`
    const encoded = (secrets.length === 2 ? [...secrets, plainToken] : secrets).map((value) =>
      Buffer.from(value, 'utf-8').toString('base64')
    )
    // The passphrase of a client key is secret too, and a transport error can quote the options.
    return [...secrets, ...encoded, ...this.tlsPassphrases()]
  }

  /**
   * Replaces every occurrence of either configured credential with a placeholder.
   *
   * A relay can echo the failing command back in its response, and a socket error
   * can carry the connection options — either would otherwise put the credential
   * into a log line and into the audit entry `EmailService` writes from the thrown
   * message.
   *
   * The **user** is scrubbed alongside the password because it is not always a
   * public login: an SES SMTP username, for one, is itself generated secret
   * material. Matching is literal and unconditional, so a short credential
   * over-redacts a message rather than risking a miss — the safe direction for a
   * control whose other failure mode is persisting a secret. The two credentials
   * can overlap — a password built from the username, say `relay` /
   * `relay-secret` — which {@link redactValues} handles by merging overlapping
   * matches into a single marker.
   *
   * @param message - The raw error message.
   * @returns The message with both credentials removed, unchanged when none is set.
   */
  private redact(message: string): string {
    return redactValues(message, this.credentialValues())
  }

  /**
   * Rejects a line break in any caller-supplied value that becomes a message header.
   *
   * Nodemailer's MIME layer already strips `CR`/`LF` from header names and values and
   * derives the envelope from parsed address objects rather than raw strings, so this
   * is defence in depth rather than the only barrier — but header injection is the
   * one place where trusting a peer dependency's current behaviour would be the whole
   * security boundary. The subject is left out on purpose: a stray trailing newline
   * from a template is plausible there, and Nodemailer's strip handles it without a
   * hard failure.
   *
   * @param options - The message envelope.
   * @throws Error When a line break appears in an address or a custom header.
   */
  private guardHeaderInjection(options: EmailSendOptions): void {
    this.rejectLineBreak('from', options.from)
    // The display name lands in the same `From` header as the address, so it is as
    // much a part of that header. Its non-CR/LF metacharacters are handled by
    // passing the sender structured rather than concatenated — see {@link SmtpSender}.
    this.rejectLineBreak('fromName', options.fromName)
    this.rejectLineBreak('replyTo', options.replyTo)
    for (const recipient of [options.to, options.cc, options.bcc].flat()) {
      this.rejectLineBreak('recipient', recipient)
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      // The offending name is deliberately NOT echoed: it carries the line break,
      // and interpolating it would inject that break into the log line instead.
      this.rejectLineBreak('header name', name)
      this.rejectLineBreak(`header ${name}`, value)
    }
  }

  /**
   * Throws when a value carries a `CR` or `LF`.
   *
   * @param field - The field name, for the error message.
   * @param value - The value to check; `undefined` passes.
   * @throws Error When the value contains a line break.
   */
  private rejectLineBreak(field: string, value: string | undefined): void {
    if (value !== undefined && /[\r\n]/.test(value)) {
      throw new Error(`SmtpEmailProvider: ${field} contains a line break — refusing to send`)
    }
  }

  /**
   * Builds the sender in Nodemailer's structured address form.
   *
   * Never concatenates the display name into `"Name <address>"` — see
   * {@link SmtpSender} for why that hands the sender away to whoever controls the
   * name.
   *
   * @param from - The sender address, if any.
   * @param fromName - The sender display name, if any.
   * @returns The sender; `name` is `''` when no display name was supplied.
   * @throws Error When no sender address is available — SMTP needs an envelope
   * sender, so an absent `from` and `defaultFrom` is a configuration bug worth
   * reporting plainly rather than a cryptic transport rejection.
   */
  private buildSender(from: string | undefined, fromName: string | undefined): SmtpSender {
    if (!from) {
      throw new Error(
        'SmtpEmailProvider: no sender address — set `email.defaultFrom` or pass `from`'
      )
    }
    return nullProto({ name: fromName ?? '', address: from })
  }

  /**
   * Returns the cached transport, lazily importing `nodemailer` on first use.
   * Concurrent first calls share one in-flight initialization promise so the dynamic
   * import and creation run exactly once; a failed init is dropped from the cache so
   * a later call can retry instead of being permanently bricked. It is dropped only while
   * it is still the cached build: `close()` may have taken it, and a newer send may have
   * started a build of its own, which a late failure here must not clear.
   *
   * @returns The initialized transport.
   * @throws Error When the configuration is incomplete or `nodemailer` is missing.
   */
  private getTransport(): Promise<Boxed<SmtpTransportLike>> {
    const cached = this.#transportPromise
    if (cached !== null) {
      return cached
    }
    const build = this.createTransport(this.#pool)
    this.#transportPromise = build
    void this.dropWhenFailed(build)
    return build
  }

  /** A pool's `verify` builds its auth object out of reach, so a pooled provider verifies unpooled. */
  private transportToVerify(): Promise<Boxed<SmtpTransportLike>> {
    return this.#pool === undefined ? this.getTransport() : this.createTransport()
  }

  /** Drops a build that failed from the cache, only while it is still the cached one. */
  private async dropWhenFailed(build: Promise<Boxed<SmtpTransportLike>>): Promise<void> {
    try {
      await own(build, 'SmtpEmailProvider')
    } catch {
      if (this.#transportPromise === build) {
        this.#transportPromise = null
      }
    }
  }

  /**
   * Builds a fresh transport.
   *
   * @param pool - The pool limits; none for an unpooled transport.
   * @returns The initialized transport.
   * @throws Error When the configuration is incomplete or `nodemailer` is missing.
   */
  private async createTransport(pool?: SmtpPoolOptions): Promise<Boxed<SmtpTransportLike>> {
    const config = this.buildTransportConfig(pool)
    const nodemailer = (await own(this.loadNodemailer(), 'SmtpEmailProvider')).value
    // Boxed: the transport is an event emitter, whose prototype chain the realm check does not cover.
    return boxed(this.instantiate(nodemailer, config))
  }

  /**
   * Calls into Nodemailer to build the transport, scrubbing the password out of a
   * failure.
   *
   * Redaction is applied here and in {@link SmtpEmailProvider.dispatch} rather than
   * around the whole initialization, because those two are the only calls that cross
   * into foreign code. This adapter's own errors — a missing host, incomplete
   * credentials — never contain the password, and running them through a substring
   * scrub would corrupt them: a one-character password rewrites every occurrence of
   * that character in the sentence.
   *
   * @param nodemailer - The loaded module surface.
   * @param config - The resolved transport configuration.
   * @returns The initialized transport.
   * @throws Error When the transport rejects its configuration.
   */
  private instantiate(nodemailer: NodemailerLike, config: SmtpTransportConfig): SmtpTransportLike {
    try {
      const transport = nodemailer.createTransport(config)
      shadowTransportAuth(transport)
      return transport
    } catch (error) {
      throw this.redactError(error)
    }
  }

  /**
   * Scrubs the password out of an initialization failure.
   *
   * `dispatch()` covers the send path, but this one covers the build path — a
   * transport implementation that validates its configuration eagerly could throw
   * with the credential pair stringified into the message, and this `catch` is the
   * only thing between that and the audit entry. An error whose message needs no
   * change is returned untouched, so its type and stack survive.
   *
   * Always an `Error`, because `IEmailProvider.send` documents that it throws one
   * and a direct caller is entitled to rely on that. Identity is preserved only for
   * an `Error` whose message needed no change — there its type and stack are worth
   * keeping; anything else is wrapped.
   *
   * @param error - The raw failure.
   * @returns The original `Error` when nothing needed scrubbing, otherwise a plain
   *   `Error` carrying the scrubbed message.
   */
  private redactError(error: unknown): Error {
    const text = describeError(error)
    const message = this.redact(text)
    // The original keeps its type and stack only when it is a readable Error that needed no scrubbing.
    return isSafeError(error) && message === text && text !== UNPRINTABLE_ERROR
      ? error
      : new Error(message)
  }

  /**
   * Resolves the transport configuration; see {@link buildSmtpTransportConfig}.
   *
   * @returns The resolved configuration.
   * @throws Error When `host` is missing, or `credentials` were supplied incomplete.
   */
  private buildTransportConfig(pool: SmtpPoolOptions | undefined): SmtpTransportConfig {
    return buildSmtpTransportConfig(this.#options, pool, () => this.resolveCredentials())
  }

  /**
   * Resolves the credential pair to hand the transport.
   *
   * @returns The credential pair, or `undefined` for an open relay.
   * @throws Error When `credentials` were supplied but are missing `user` or `pass`
   * — that is a deployment declaring it logs in while its secrets failed to load, so
   * it must fail closed rather than fall back to an anonymous send.
   */
  private resolveCredentials(): { user: string; pass: string } | undefined {
    const credentials = this.#options.credentials
    if (credentials === undefined) {
      return undefined
    }
    if (!areCredentialsComplete(credentials)) {
      throw new Error(
        'SmtpEmailProvider: incomplete credentials — `credentials` needs both `user` and `pass`'
      )
    }
    return withOwnKeys({ user: credentials.user, pass: credentials.pass }, AUTH_KEYS)
  }

  /**
   * Dynamically imports the optional `nodemailer` peer dependency, tolerating both
   * shapes the specifier can resolve to — a namespace carrying `createTransport` as
   * a named export, and one where the CommonJS module lands under `default`.
   *
   * @returns The module's callable surface.
   * @throws Error When the package is not installed, or — reported as itself rather
   * than as a missing package — when the import fails for any other reason.
   */
  private async loadNodemailer(): Promise<Boxed<NodemailerLike>> {
    const mod = await own(
      loadOptionalPeer<Partial<NodemailerLike> & { default?: Partial<NodemailerLike> }>(
        NODEMAILER_MODULE
      ),
      'SmtpEmailProvider'
    )
    const candidate = mod.createTransport ? mod : mod.default
    if (!candidate?.createTransport) {
      throw new Error('`nodemailer` package exposes no createTransport export')
    }
    return boxed(candidate as NodemailerLike)
  }
}
