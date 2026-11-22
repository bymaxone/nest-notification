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
 * The options of a TLS connection: the host and port, then each option of the host that is set. A
 * value that reads as `undefined` is not set, so it cannot replace the default Node applies.
 *
 * @param plan - The resolved plan.
 * @returns A prototype-less options object.
 */
function tlsOptions(plan: SmtpSocketPlan): tls.ConnectionOptions {
  const set = Object.entries(plan.tls ?? {}).filter(([, value]) => value !== undefined)
  return nullProto({ host: plan.host, port: plan.port, ...Object.fromEntries(set) })
}

/**
 * Events Node emits on a socket that this adapter does not use. Emitting an event with no listener
 * reads the name from the emitter's table of listeners, which can reach `Object.prototype`: a string
 * planted there as `lookup` is read by Node's own emitter on a later tick and throws, uncaught. A
 * listener of its own for each of them keeps those reads on the socket.
 */
const QUIET_EVENTS = [
  'lookup',
  'connectionAttempt',
  'connectionAttemptFailed',
  'connectionAttemptTimeout',
  'ready',
  'keylog',
  'session',
  'OCSPResponse'
] as const

/** Gives a socket a listener that does nothing for each event of {@link QUIET_EVENTS}. */
function quiet<T extends net.Socket>(socket: T): T {
  for (const event of QUIET_EVENTS) {
    socket.on(event, () => undefined)
  }
  return socket
}

/**
 * Starts the connection of a plan. A plain connection is made on a socket that has its listeners
 * before it connects; a TLS one gets them in the same run as `tls.connect`, before any event can
 * fire, since Node emits them on a later tick.
 *
 * @param plan - The resolved plan.
 * @returns The socket, connecting.
 */
function connect(plan: SmtpSocketPlan): net.Socket {
  if (plan.secure) {
    return quiet(tls.connect(tlsOptions(plan)))
  }
  return quiet(new net.Socket()).connect(nullProto({ host: plan.host, port: plan.port }))
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
