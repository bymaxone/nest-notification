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

import type {
  EmailAttachment,
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'
import { loadOptionalPeer } from '../utils/load-optional-peer'
import { collectEchoedExcerpts, redactValues } from '../utils/redact'

/** Submission port, used when no `port` is supplied. */
const DEFAULT_PORT = 587

/** Port that implies implicit TLS ("SMTPS"), used to derive `secure` by default. */
const IMPLICIT_TLS_PORT = 465

/** Default TCP connection timeout, in milliseconds. */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000

/** Default timeout for the server greeting, in milliseconds. */
const DEFAULT_GREETING_TIMEOUT_MS = 10_000

/** Default idle-socket timeout during the SMTP conversation, in milliseconds. */
const DEFAULT_SOCKET_TIMEOUT_MS = 20_000

/** Placeholder substituted for a credential inside surfaced error messages. */
const REDACTED = '[redacted]'

/**
 * Hosts that cannot be reached across a network, and for which an unencrypted
 * session is therefore not exposed to a STARTTLS-stripping attacker. Used to decide
 * the `requireTls` default.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** TLS knobs forwarded to the transport, for relays using a private CA. */
export interface SmtpTlsOptions {
  /**
   * Whether to reject a certificate that does not validate against the trust store.
   * Defaults to Node's `true`. Setting it to `false` disables certificate
   * verification and exposes the connection to interception — prefer supplying the
   * relay's CA via {@link SmtpTlsOptions.ca}.
   */
  rejectUnauthorized?: boolean
  /** SNI server name, when it differs from `host`. */
  servername?: string
  /** Additional trusted CA certificate(s), in PEM form. */
  ca?: string | string[]
}

/**
 * Login credentials for the SMTP session (the protocol's `AUTH` command, RFC 4954).
 * Both fields must be non-empty for the provider to be configured.
 */
export interface SmtpCredentials {
  /**
   * Login user. Explicitly `| undefined` — not merely optional — so a consumer can
   * pass `process.env.SMTP_USER` straight through under `exactOptionalPropertyTypes`.
   * A missing variable then makes `isConfigured()` answer `false` instead of forcing
   * a non-null assertion at the call site or logging in as `undefined`.
   */
  user?: string | undefined
  /** Login password (or app/API secret). See {@link SmtpCredentials.user}. */
  pass?: string | undefined
}

/** Construction options for {@link SmtpEmailProvider}. */
export interface SmtpEmailProviderOptions {
  /**
   * Relay hostname or IP. Required — without it the provider is not configured.
   * Explicitly `| undefined` so `process.env.SMTP_HOST` can be passed straight
   * through; see {@link SmtpCredentials.user}.
   */
  host?: string | undefined
  /** TCP port. Defaults to `587` (submission). */
  port?: number
  /**
   * Whether TLS wraps the connection from the first byte (implicit TLS, port 465).
   * Defaults to `true` only when `port` is `465`. Leave `false` for submission and
   * plaintext capture servers; the connection is still upgraded through STARTTLS
   * when the relay advertises it. Use {@link SmtpEmailProviderOptions.requireTls}
   * to make that upgrade mandatory.
   */
  secure?: boolean
  /**
   * Whether to require a STARTTLS upgrade on a non-implicit-TLS connection, failing
   * the send when the relay does not offer it.
   *
   * **Defaults to `true` for any non-loopback host**, and to `false` for
   * `localhost` / `127.0.0.1` / `::1` (the local capture-server case) and whenever
   * `secure` is already on. Without it, whether the session is encrypted at all is
   * decided by the plaintext EHLO banner: an attacker with network position strips
   * the `250-STARTTLS` line, the transport never upgrades, and the credentials and
   * the body — which carries OTP codes — cross the network in the clear. Set it to
   * `false` explicitly for a relay you know cannot upgrade.
   */
  requireTls?: boolean
  /** Login credentials. Omit entirely for an open relay (e.g. Mailpit). */
  credentials?: SmtpCredentials
  /** TLS knobs, for a relay presenting a certificate from a private CA. */
  tls?: SmtpTlsOptions
  /** TCP connection timeout in milliseconds. Defaults to `10000`. */
  connectionTimeout?: number
  /** Server-greeting timeout in milliseconds. Defaults to `10000`. */
  greetingTimeout?: number
  /** Idle-socket timeout in milliseconds. Defaults to `20000`. */
  socketTimeout?: number
}

/**
 * The transport configuration this adapter hands to `createTransport`. The key is
 * `auth` because that is Nodemailer's own wire name for the credential pair.
 */
interface SmtpTransportConfig {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  auth: { user: string; pass: string } | undefined
  tls: SmtpTlsOptions | undefined
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
}

/** An attachment in the shape Nodemailer expects. */
interface SmtpAttachment {
  filename: string
  content: Buffer | string
  contentType: string | undefined
  encoding: string | undefined
}

/**
 * A sender in Nodemailer's structured address form.
 *
 * Structured rather than a `"Name <address>"` string on purpose: handed a string,
 * Nodemailer *parses* it, so a display name containing its own angle-addr — say
 * `Mallory <mallory@evil.example>` — would supply the `From` address and the
 * envelope sender instead of the configured one. Given the object, the name is
 * never parsed; Nodemailer quotes it (and RFC-2047-encodes it when non-ASCII) while
 * the address stays exactly what this adapter chose.
 */
interface SmtpSender {
  name: string
  address: string
}

/** The exact payload subset {@link SmtpEmailProvider} forwards to the transport. */
interface SmtpSendPayload {
  from: SmtpSender
  to: string | string[]
  subject: string
  html: string
  text: string | undefined
  replyTo: string | undefined
  cc: string | string[] | undefined
  bcc: string | string[] | undefined
  headers: Record<string, string> | undefined
  attachments: SmtpAttachment[] | undefined
}

/** The slim transport surface this adapter relies on. */
interface SmtpTransportLike {
  sendMail(payload: SmtpSendPayload): Promise<{ messageId?: string }>
}

/** The slim surface of the `nodemailer` module this adapter relies on. */
interface NodemailerLike {
  createTransport(config: SmtpTransportConfig): SmtpTransportLike
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
export class SmtpEmailProvider implements IEmailProvider {
  readonly name = 'smtp'
  private readonly logger = new Logger(SmtpEmailProvider.name)
  /**
   * Cached in-flight (or resolved) transport initialization. `null` until the first
   * `send()` and after a failed init. Caching the PROMISE (not just the transport)
   * collapses concurrent first sends onto a single dynamic `import()` + creation;
   * a failed init resets this back to `null` so a transient error can be retried.
   */
  #transportPromise: Promise<SmtpTransportLike> | null = null

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

  /**
   * @param options - Adapter options; `host` is required to actually send, and
   *   `credentials` must be complete whenever supplied at all.
   */
  constructor(options: SmtpEmailProviderOptions = {}) {
    this.#options = options
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
    this.guardHeaderInjection(options)
    const from = this.buildSender(options.from, options.fromName)
    const transport = await this.getTransport()
    const info = await this.dispatch(
      transport,
      {
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        replyTo: options.replyTo,
        cc: options.cc,
        bcc: options.bcc,
        headers: options.headers,
        attachments: this.mapAttachments(options.attachments)
      },
      options.redactValues
    )
    if (!info.messageId) {
      throw new Error('SMTP transport returned no message ID')
    }
    return { messageId: info.messageId }
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
    redactValues?: readonly string[]
  ): Promise<{ messageId?: string }> {
    try {
      return await transport.sendMail(payload)
    } catch (error) {
      // Credentials first, then the caller's declared secrets, then any
      // excerpt of the body the transport error is ECHOING — a policy/DLP
      // relay that quotes the rejected content puts the body (and any secret
      // inside it) into the error text this line is about to log.
      const reason = this.scrubTransportError(
        this.redact(error instanceof Error ? error.message : String(error)),
        payload,
        redactValues
      )
      this.logger.warn(`[SMTP_SEND_FAILED] ${reason}`)
      throw new Error(`SMTP send failed: ${reason}`)
    }
  }

  /**
   * Removes the caller's declared secrets and any echoed body excerpt from a
   * transport error's text — the credential scrub alone cannot cover content
   * the provider does not know is secret.
   */
  private scrubTransportError(
    message: string,
    payload: SmtpSendPayload,
    declaredValues: readonly string[] | undefined
  ): string {
    const values = collectEchoedExcerpts(message, payload.html)
    if (payload.text !== undefined) {
      values.push(...collectEchoedExcerpts(message, payload.text))
    }
    if (declaredValues) {
      values.push(...declaredValues)
    }
    return redactValues(message, values)
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
   * control whose other failure mode is persisting a secret.
   *
   * @param message - The raw error message.
   * @returns The message with both credentials removed, unchanged when none is set.
   */
  private redact(message: string): string {
    const credentials = this.#options.credentials
    const secrets = [credentials?.user, credentials?.pass]
      .filter((secret): secret is string => Boolean(secret))
      // Longest first. The two credentials can overlap — a password built from the
      // username, say `relay` / `relay-secret` — and replacing the shorter one first
      // consumes the prefix, leaving `[redacted]-secret`: the part that actually
      // distinguishes the password survives into the log and the audit entry.
      .sort((a, b) => b.length - a.length)
    let redacted = message
    for (const secret of secrets) {
      redacted = redacted.split(secret).join(REDACTED)
    }
    return redacted
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
    return { name: fromName ?? '', address: from }
  }

  /**
   * Maps the library's attachments onto Nodemailer's shape.
   *
   * `EmailAttachment.content` is documented as a `Buffer` **or a base64 string**, so
   * a string is tagged `encoding: 'base64'` — left untagged, Nodemailer would treat
   * the base64 text as the literal body and deliver a corrupt file.
   *
   * @param attachments - The attachments to map, if any.
   * @returns The mapped attachments, or `undefined` when there are none.
   */
  private mapAttachments(
    attachments: ReadonlyArray<EmailAttachment> | undefined
  ): SmtpAttachment[] | undefined {
    return attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
      encoding: typeof attachment.content === 'string' ? 'base64' : undefined
    }))
  }

  /**
   * Returns the cached transport, lazily importing `nodemailer` on first use.
   * Concurrent first calls share one in-flight initialization promise so the dynamic
   * import and creation run exactly once; a failed init is dropped from the cache so
   * a later call can retry instead of being permanently bricked.
   *
   * @returns The initialized transport.
   * @throws Error When the configuration is incomplete or `nodemailer` is missing.
   */
  private getTransport(): Promise<SmtpTransportLike> {
    this.#transportPromise ??= this.createTransport()
    return this.#transportPromise
  }

  /**
   * Builds a fresh transport, resetting the cached promise on any failure so the
   * provider is not permanently bricked by a transient init error.
   *
   * @returns The initialized transport.
   * @throws Error When the configuration is incomplete or `nodemailer` is missing.
   */
  private async createTransport(): Promise<SmtpTransportLike> {
    try {
      const config = this.buildTransportConfig()
      const nodemailer = await this.loadNodemailer()
      return this.instantiate(nodemailer, config)
    } catch (error) {
      this.#transportPromise = null
      throw error
    }
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
      return nodemailer.createTransport(config)
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
    if (error instanceof Error) {
      const message = this.redact(error.message)
      return message === error.message ? error : new Error(message)
    }
    return new Error(this.redact(String(error)))
  }

  /**
   * Resolves the transport configuration, applying defaults and validating that the
   * relay is fully described.
   *
   * @returns The resolved configuration.
   * @throws Error When `host` is missing, or `credentials` were supplied incomplete.
   */
  private buildTransportConfig(): SmtpTransportConfig {
    const options = this.#options
    const host = options.host
    if (!host) {
      throw new Error('SmtpEmailProvider: missing host — pass { host } to the constructor')
    }
    const port = options.port ?? DEFAULT_PORT
    const secure = options.secure ?? port === IMPLICIT_TLS_PORT
    return {
      host,
      port,
      secure,
      requireTLS: options.requireTls ?? (!secure && !LOOPBACK_HOSTS.has(host.toLowerCase())),
      auth: this.resolveCredentials(),
      tls: options.tls,
      connectionTimeout: options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      greetingTimeout: options.greetingTimeout ?? DEFAULT_GREETING_TIMEOUT_MS,
      socketTimeout: options.socketTimeout ?? DEFAULT_SOCKET_TIMEOUT_MS
    }
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
    return { user: credentials.user, pass: credentials.pass }
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
  private async loadNodemailer(): Promise<NodemailerLike> {
    const mod = await loadOptionalPeer<
      Partial<NodemailerLike> & { default?: Partial<NodemailerLike> }
    >(NODEMAILER_MODULE)
    const candidate = mod.createTransport ? mod : mod.default
    if (!candidate?.createTransport) {
      throw new Error('`nodemailer` package exposes no createTransport export')
    }
    return candidate as NodemailerLike
  }
}
