/**
 * @fileoverview A connection that checks the realm root before every byte it writes, and that
 * Nodemailer can upgrade to TLS without taking the writes out of the check.
 * @layer infrastructure
 *
 * Nodemailer upgrades a STARTTLS session itself, with `tls.connect({ socket })`. Given a native
 * `net.Socket` the encrypted bytes are written by the socket's handle, below any `write` the adapter
 * could wrap. Given any other `Duplex`, Node writes every encrypted byte through that stream's own
 * `write`, so the check here sees the whole session: `EHLO`, `MAIL FROM`, `RCPT TO` and the body.
 */

import type * as net from 'node:net'
import { Duplex } from 'node:stream'

import { assertStandardRealmRoot } from '../utils/realm-root'

// Read from the global once, when the module loads: the stream calls its owner's methods through it.
const apply = Reflect.apply

/** The socket the stream stands for. */
type Inner = net.Socket

/**
 * A duplex stream over an open socket that refuses to write while `Object.prototype` holds a key
 * that is not standard: the connection is destroyed with the refusal, so the send fails and nothing
 * after it leaves.
 */
export class GuardedConnection extends Duplex {
  readonly #inner: Inner

  /**
   * @param inner - An open socket, not yet read from.
   */
  constructor(inner: Inner) {
    super()
    // No prototype for the table of listeners: Node's emitter reads an event name from it, and a
    // string planted under that name on the realm root would be read and throw on a later tick.
    Object.setPrototypeOf(Reflect.get(this, '_events') as object, null)
    this.#inner = inner
    inner.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) {
        inner.pause()
      }
    })
    inner.on('end', () => this.push(null))
    inner.on('error', (error: Error) => this.destroy(error))
    inner.on('close', () => this.destroy())
    inner.on('timeout', () => this.emit('timeout'))
  }

  /** @inheritdoc */
  override _read(): void {
    this.#inner.resume()
  }

  /** @inheritdoc */
  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    done: (error?: Error | null) => void
  ): void {
    try {
      assertStandardRealmRoot('SmtpEmailProvider')
    } catch (error) {
      this.#inner.destroy(error as Error)
      done(error as Error)
      return
    }
    apply(this.#inner.write, this.#inner, [chunk, encoding, done])
  }

  /** @inheritdoc */
  override _final(done: (error?: Error | null) => void): void {
    try {
      assertStandardRealmRoot('SmtpEmailProvider')
    } catch (error) {
      this.#inner.destroy(error as Error)
      done(error as Error)
      return
    }
    apply(this.#inner.end, this.#inner, [done])
  }

  /**
   * Closes the socket underneath, and reports the close one turn of the event loop later: when the TLS
   * layer ends a session it destroys this stream first and raises the reason on its own socket after,
   * and Nodemailer treats a close that comes first as the connection having dropped.
   */
  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    this.#inner.destroy(error ?? undefined)
    setImmediate(done, error)
  }

  /** The address of the peer, as the socket underneath has it. */
  get remoteAddress(): string | undefined {
    return this.#inner.remoteAddress
  }

  /** The port of the peer, as the socket underneath has it. */
  get remotePort(): number | undefined {
    return this.#inner.remotePort
  }

  /** The local address, as the socket underneath has it. */
  get localAddress(): string | undefined {
    return this.#inner.localAddress
  }

  /** The local port, as the socket underneath has it. */
  get localPort(): number | undefined {
    return this.#inner.localPort
  }

  /** Turns TCP keepalive on or off on the socket underneath, which Nodemailer asks of a socket it is given. */
  setKeepAlive(enable?: boolean, initialDelay?: number): this {
    this.#inner.setKeepAlive(enable, initialDelay)
    return this
  }

  /** Turns Nagle's algorithm off or on for the socket underneath, which Nodemailer asks of a socket it is given. */
  setNoDelay(noDelay?: boolean): this {
    this.#inner.setNoDelay(noDelay)
    return this
  }

  /** Sets the idle timeout of the socket underneath; its `timeout` event is forwarded. */
  setTimeout(milliseconds: number, listener?: () => void): this {
    this.#inner.setTimeout(milliseconds)
    if (listener) {
      this.once('timeout', listener)
    }
    return this
  }
}
