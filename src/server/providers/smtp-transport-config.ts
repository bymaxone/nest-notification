/**
 * @fileoverview Resolves the configuration SmtpEmailProvider hands to Nodemailer: the defaults, the
 * pool settings, the own keys for every name Nodemailer reads, and the adapter's own socket.
 * @layer infrastructure
 */

import { withOwnKeys } from '../utils/read-options'
import { ownTlsKeys, TRANSPORT_KEYS } from './nodemailer-keys'
import type {
  SmtpEmailProviderOptions,
  SmtpPoolOptions,
  SmtpTransportConfig
} from './smtp-email.types'
import { smtpGetSocket } from './smtp-socket'

/** Default submission port when none is configured. */
const DEFAULT_PORT = 587

/** Port that implies implicit TLS ("SMTPS"), used to derive `secure` by default. */
const IMPLICIT_TLS_PORT = 465

/** Default TCP connection timeout, in milliseconds. */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000

/** Default timeout for the server greeting, in milliseconds. */
const DEFAULT_GREETING_TIMEOUT_MS = 10_000

/** Default idle-socket timeout during the SMTP conversation, in milliseconds. */
const DEFAULT_SOCKET_TIMEOUT_MS = 20_000

/**
 * Hosts that cannot be reached across a network, and for which an unencrypted
 * session is therefore not exposed to a STARTTLS-stripping attacker. Used to decide
 * the `requireTls` default.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * The transport settings a pool turns on: none without the option, so an unpooled transport gets
 * the configuration it always did.
 *
 * @param pool - The validated option.
 * @returns The keys to add to the transport configuration.
 */
function poolConfig(
  pool: SmtpPoolOptions | undefined
): Pick<SmtpTransportConfig, 'pool' | 'maxConnections' | 'maxMessages'> {
  if (pool === undefined) {
    return {}
  }
  return {
    pool: true,
    ...(pool.maxConnections === undefined ? {} : { maxConnections: pool.maxConnections }),
    ...(pool.maxMessages === undefined ? {} : { maxMessages: pool.maxMessages })
  }
}

/**
 * Resolves the transport configuration, applying defaults and validating that the relay is fully
 * described. The connection is opened by the adapter (`getSocket`) from this configuration, and
 * Nodemailer is told never to open a file or a URL (`disableFileAccess`, `disableUrlAccess`): the
 * adapter sends `content` only, so a `path` or `href` that appears on an object Nodemailer reads
 * late is refused, not followed.
 *
 * @param options - The options the provider keeps.
 * @param pool - The validated pool option.
 * @param credentials - Resolves the credential pair, called after the host is checked.
 * @returns The resolved configuration.
 * @throws Error When `host` is missing, or `credentials` were supplied incomplete.
 */
export function buildSmtpTransportConfig(
  options: SmtpEmailProviderOptions,
  pool: SmtpPoolOptions | undefined,
  credentials: () => SmtpTransportConfig['auth']
): SmtpTransportConfig {
  const host = options.host
  if (!host) {
    throw new Error('SmtpEmailProvider: missing host — pass { host } to the constructor')
  }
  const port = options.port ?? DEFAULT_PORT
  const secure = options.secure ?? port === IMPLICIT_TLS_PORT
  const connectionTimeout = options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS
  return withOwnKeys(
    {
      host,
      port,
      secure,
      requireTLS: options.requireTls ?? (!secure && !LOOPBACK_HOSTS.has(host.toLowerCase())),
      auth: credentials(),
      tls: ownTlsKeys(options.tls),
      connectionTimeout,
      getSocket: smtpGetSocket({
        host,
        port,
        secure,
        tls: options.tls,
        connectionTimeoutMs: connectionTimeout
      }),
      disableFileAccess: true as const,
      disableUrlAccess: true as const,
      greetingTimeout: options.greetingTimeout ?? DEFAULT_GREETING_TIMEOUT_MS,
      socketTimeout: options.socketTimeout ?? DEFAULT_SOCKET_TIMEOUT_MS,
      ...poolConfig(pool)
    },
    TRANSPORT_KEYS
  )
}
