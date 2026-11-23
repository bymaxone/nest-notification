/**
 * @fileoverview Opens the connection of the SMTP adapter itself, from the adapter's own resolved
 * configuration, and hands Nodemailer the socket that is already open.
 * @layer infrastructure
 *
 * Left to open it, Nodemailer builds the options of `net.connect` and `tls.connect` as ordinary
 * objects and Node reads names from them that nobody set (`path`, `localAddress`, `onread`,
 * `servername`, `autoSelectFamily`), some of them after `sendMail` has returned, so a key planted on
 * the realm root by a concurrent request could move the connection to a unix socket or another
 * address. A check cannot close a timing window; reading nothing can. The options here have no
 * prototype and are built only from the configuration, so Node reads no prototype for them.
 */

import * as net from 'node:net'
import * as tls from 'node:tls'

import { nullProto } from '../utils/read-options'
import { assertStandardRealmRoot } from '../utils/realm-root'

// Read from the global once, when the module loads: the guard below calls the socket's methods through
// it, so a `bind` or a `call` replaced later cannot hand the guard an unguarded method.
const apply = Reflect.apply

/** What the connection needs, resolved before the transport is built. */
export interface SmtpSocketPlan {
  readonly host: string
  readonly port: number
  /** Whether the connection starts in TLS (implicit TLS); STARTTLS is left to Nodemailer. */
  readonly secure: boolean
  /** The host's `tls` options, which a TLS connection starts with. */
  readonly tls: object | undefined
  /** How long the connection may take to open, in milliseconds. */
  readonly connectionTimeoutMs: number
}

/** What Nodemailer's `getSocket` hands back: the open socket, and whether TLS is already on it. */
type SocketAnswer = (
  error: Error | null,
  socket?: { readonly connection: net.Socket; readonly secured: boolean }
) => void

/**
 * The options of a TLS connection: the host and port, the host's name as the SNI name when it is a
 * name, then each option of the host that is set. A
 * value that reads as `undefined` is not set, so it cannot replace the default Node applies.
 *
 * @param plan - The resolved plan.
 * @returns A prototype-less options object.
 */
function tlsOptions(plan: SmtpSocketPlan): tls.ConnectionOptions {
  const set = Object.entries(plan.tls ?? {}).filter(([, value]) => value !== undefined)
  // Node sends no SNI on its own: a relay that picks its certificate by name needs the host's, unless
  // the host is an address, which SNI cannot carry, or the caller set one.
  const servername = net.isIP(plan.host) === 0 ? { servername: plan.host } : {}
  return nullProto({ host: plan.host, port: plan.port, ...servername, ...Object.fromEntries(set) })
}

/**
 * Gives a socket's table of listeners no prototype. Emitting an event reads its name from that table,
 * and the table is an ordinary object, so a string planted on `Object.prototype` under an event name
 * (`lookup`, `resume`, `drain`, any other) is read by Node's own emitter on a later tick and throws,
 * uncaught. With no prototype nothing is inherited, whatever the name, and the listeners the socket
 * and Nodemailer register keep working.
 *
 * @param socket - A socket that has not started to connect, or has not yet had a tick.
 * @returns The same socket.
 */
function seal<T extends net.Socket>(socket: T): T {
  Object.setPrototypeOf(Reflect.get(socket, '_events') as object, null)
  return socket
}

/**
 * Starts the connection of a plan. A plain connection is made on a socket whose table of listeners is
 * sealed before it connects; a TLS one is sealed in the same run as `tls.connect`, before any event
 * can fire, since Node emits them on a later tick.
 *
 * @param plan - The resolved plan.
 * @returns The socket, connecting.
 */
function connect(plan: SmtpSocketPlan): net.Socket {
  if (plan.secure) {
    return seal(tls.connect(tlsOptions(plan)))
  }
  return seal(new net.Socket()).connect(nullProto({ host: plan.host, port: plan.port }))
}

/**
 * Makes every write to a socket check the realm root first. A key planted after the check that began
 * the send, and before a byte leaves, would change what Nodemailer builds from ordinary objects; a
 * write made while the realm is polluted destroys the connection with the refusal, so the send fails
 * and nothing is sent after it. It covers the sockets the adapter opens; the socket of a STARTTLS
 * upgrade is made by Nodemailer and is outside it.
 *
 * @param socket - A connected socket.
 */
function guardWrites(socket: net.Socket): void {
  const write = socket.write as (...args: unknown[]) => boolean
  const end = socket.end as (...args: unknown[]) => net.Socket
  socket.write = ((...args: unknown[]): boolean => {
    try {
      assertStandardRealmRoot('SmtpEmailProvider')
    } catch (error) {
      socket.destroy(error as Error)
      return false
    }
    return apply(write, socket, args)
  }) as net.Socket['write']
  socket.end = ((...args: unknown[]): net.Socket => {
    try {
      assertStandardRealmRoot('SmtpEmailProvider')
    } catch (error) {
      return socket.destroy(error as Error)
    }
    return apply(end, socket, args)
  }) as net.Socket['end']
}

/**
 * Opens the socket, and answers once it is connected (and, for implicit TLS, secured) or has failed.
 *
 * @param plan - The resolved plan.
 * @param answer - Nodemailer's callback.
 */
function open(plan: SmtpSocketPlan, answer: SocketAnswer): void {
  let socket: net.Socket
  try {
    assertStandardRealmRoot('SmtpEmailProvider')
    socket = connect(plan)
  } catch (error) {
    setImmediate(answer, error as Error)
    return
  }
  const ready = plan.secure ? 'secureConnect' : 'connect'
  const settle = (error: Error | null): void => {
    clearTimeout(timer)
    socket.removeListener('error', settle)
    socket.removeListener(ready, onReady)
    if (error === null) {
      guardWrites(socket)
      answer(null, { connection: socket, secured: plan.secure })
      return
    }
    socket.destroy()
    answer(error)
  }
  const onReady = (): void => settle(null)
  const timer = setTimeout(() => {
    settle(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }))
  }, plan.connectionTimeoutMs)
  socket.once('error', settle)
  socket.once(ready, onReady)
}

/**
 * Nodemailer's `getSocket` option for a plan.
 *
 * @param plan - The resolved plan.
 * @returns The function to hand to `createTransport`; it ignores the options Nodemailer passes.
 */
export function smtpGetSocket(
  plan: SmtpSocketPlan
): (options: unknown, answer: SocketAnswer) => void {
  return (_options, answer) => open(plan, answer)
}
