/**
 * @fileoverview The option types of `SmtpEmailProvider` and the shapes it exchanges with
 * Nodemailer. Types only; the provider re-exports the public ones, so an import from
 * `./smtp-email.provider` keeps working.
 * @layer infrastructure
 */

/**
 * TLS knobs forwarded to the transport: a private CA, the protocol bounds, the ciphers, a custom
 * identity check and a client certificate. These are the only keys accepted; any other key of `tls`
 * is refused when the provider is built, because a setting that is dropped without a word can leave
 * the connection weaker than the host asked for.
 */
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
  ca?: string | Buffer | ReadonlyArray<string | Buffer>
  /** The lowest TLS version the session may negotiate. */
  minVersion?: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3'
  /** The highest TLS version the session may negotiate. */
  maxVersion?: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3'
  /** The cipher suites the session may use, in OpenSSL list format. */
  ciphers?: string
  /**
   * Replaces the check of the certificate against the server name; return an error to refuse it.
   * Declared as a method so a callback typed with Node's own `PeerCertificate` is assignable.
   */
  checkServerIdentity?(hostname: string, cert: object): Error | undefined
  /** The client certificate chain, in PEM form. */
  cert?: string | Buffer | ReadonlyArray<string | Buffer>
  /** The private key of the client certificate, in PEM form. */
  key?: string | Buffer | ReadonlyArray<string | Buffer>
  /** The passphrase of an encrypted `key` or `pfx`. A secret: it is never printed. */
  passphrase?: string
  /** The client certificate and key as a PKCS#12 bundle. */
  pfx?: string | Buffer | ReadonlyArray<string | Buffer>
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
  /**
   * Longest one `send()` may take, in milliseconds, from the call to the transport's answer. An
   * integer from `1` to `2147483647`; default `60000`. The three timeouts above bound a phase or an
   * idle socket, so a relay that keeps trickling bytes could hold a send past all of them; this
   * bounds the whole call. A send that exceeds it fails with `EMAIL_SEND_FAILED` (HTTP 503). The
   * relay may still accept the message: only the answer is missing, so the failure does not say the
   * message was not sent. The connection is left open: `socketTimeout` reaps it once the relay goes idle; a relay that keeps sending holds it until the relay ends the connection or the process exits.
   */
  sendTimeoutMs?: number
  /**
   * Keeps connections to the relay open and reuses them, instead of one connection per send.
   * Setting it, even to `{}`, turns Nodemailer's pooled mode on; each limit left out keeps
   * Nodemailer's own default. Each is an integer of at least `1`.
   *
   * A pool holds sockets open, so close it with {@link SmtpEmailProvider.close} when the application
   * stops; Nest does that for you when the application closes. `sendTimeoutMs` also covers the wait
   * for a free connection.
   */
  pool?: SmtpPoolOptions
}

/** The limits of a pooled transport; each left out keeps Nodemailer's default. */
export interface SmtpPoolOptions {
  /** Most connections open to the relay at once. An integer of at least `1`. */
  maxConnections?: number
  /** Most messages sent over one connection before it is replaced. An integer of at least `1`. */
  maxMessages?: number
}

/**
 * The transport configuration this adapter hands to `createTransport`. The key is
 * `auth` because that is Nodemailer's own wire name for the credential pair.
 */
export interface SmtpTransportConfig {
  host: string
  port: number
  secure: boolean
  requireTLS: boolean
  auth: { user: string; pass: string } | undefined
  tls: SmtpTlsOptions | undefined
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
  /** Present, as `true`, only when the pool option is set. */
  pool?: true
  maxConnections?: number
  maxMessages?: number
}

/** An attachment in the shape Nodemailer expects. */
export interface SmtpAttachment {
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
export interface SmtpSender {
  name: string
  address: string
}

/** The exact payload subset {@link SmtpEmailProvider} forwards to the transport. */
export interface SmtpSendPayload {
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
export interface SmtpTransportLike {
  sendMail(payload: SmtpSendPayload): Promise<{ messageId?: string }>
  /** Nodemailer's transports have it; the stand-ins of a test may not. */
  close?(): void
}

/** The slim surface of the `nodemailer` module this adapter relies on. */
export interface NodemailerLike {
  createTransport(config: SmtpTransportConfig): SmtpTransportLike
}

/**
 * Every option of {@link SmtpEmailProviderOptions}, by name. The provider reads its options by
 * property access on these keys, so a class that supplies them from the prototype works; the
 * compiler refuses a name that is not an option, and the specs list every option of the type.
 */
export const SMTP_OPTION_KEYS = [
  'host',
  'port',
  'secure',
  'requireTls',
  'credentials',
  'tls',
  'connectionTimeout',
  'greetingTimeout',
  'socketTimeout',
  'sendTimeoutMs',
  'pool'
] as const satisfies readonly (keyof SmtpEmailProviderOptions)[]

/** Every key of {@link SmtpCredentials}, by name. */
export const SMTP_CREDENTIAL_KEYS = [
  'user',
  'pass'
] as const satisfies readonly (keyof SmtpCredentials)[]

/** Every key of {@link SmtpTlsOptions}, by name. */
export const SMTP_TLS_KEYS = [
  'rejectUnauthorized',
  'servername',
  'ca',
  'minVersion',
  'maxVersion',
  'ciphers',
  'checkServerIdentity',
  'cert',
  'key',
  'passphrase',
  'pfx'
] as const satisfies readonly (keyof SmtpTlsOptions)[]

/**
 * The options whose default is the weaker transport or login posture: a `null` for one is refused,
 * not read as not set, so a missing value from a config lookup cannot start an unauthenticated or
 * unsecured session.
 */
export const SMTP_WEAKER_WHEN_UNSET = [
  'secure',
  'requireTls',
  'credentials'
] as const satisfies readonly (keyof SmtpEmailProviderOptions)[]
