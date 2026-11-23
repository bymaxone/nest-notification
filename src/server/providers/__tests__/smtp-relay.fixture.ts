/**
 * @fileoverview A minimal SMTP relay on a local port, for the specs that run the real Nodemailer and
 * real sockets: it greets, answers the envelope, takes the message, and can upgrade to TLS.
 * @layer test
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import * as net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tls from 'node:tls'

/** A self-signed certificate for 127.0.0.1 and its key, made for one run of a spec. */
export interface TestCertificate {
  readonly cert: string
  readonly key: string
}

/** What the relay saw. */
export interface RelayLog {
  readonly commands: string[]
  readonly messages: string[]
  /** The names clients sent as SNI, when the relay serves TLS from the first byte. */
  readonly servernames: string[]
  /** The MAIL FROM and RCPT TO lines, as the client sent them. */
  readonly envelope: string[]
}

/** A running relay. */
export interface Relay extends RelayLog {
  readonly port: number
  close(): Promise<void>
}

/**
 * Makes a self-signed certificate valid for 127.0.0.1 with the `openssl` of the machine.
 *
 * @returns The certificate and its key, in PEM.
 */
export function makeCertificate(): TestCertificate {
  const directory = mkdtempSync(join(tmpdir(), 'relay-cert-'))
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem')
      ],
      { stdio: 'ignore' }
    )
    return {
      cert: readFileSync(join(directory, 'cert.pem'), 'utf8'),
      key: readFileSync(join(directory, 'key.pem'), 'utf8')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Keeps a key planted on Node's root from reaching this relay's own sockets: the relay shares the
 * process with the code under test, and Node's emitter would read a planted event name on them.
 */
function sealed<T extends net.Socket>(socket: T): T {
  Object.setPrototypeOf(Reflect.get(socket, '_events') as object, null)
  return socket
}

/** Notes a command line in what the relay saw: its verb, and the whole line for an envelope command. */
function record(log: RelayLog, line: string): void {
  log.commands.push(line.split(' ')[0]?.toUpperCase() ?? '')
  if (/^(MAIL|RCPT)/iu.test(line)) {
    log.envelope.push(line)
  }
}

/** Adds to a message body; once it ends with the terminator the message is logged and acknowledged. */
function collect(socket: net.Socket, log: RelayLog, body: string): string | undefined {
  if (!body.endsWith('\r\n.\r\n')) {
    return body
  }
  log.messages.push(body)
  socket.write('250 queued\r\n')
  return undefined
}

/** Answers the SMTP conversation on one socket, upgrading it on STARTTLS when it has a certificate. */
function converse(
  socket: net.Socket,
  log: RelayLog,
  certificate: TestCertificate | undefined,
  onStarttls?: () => void
): void {
  let body: string | undefined
  let pending = ''
  socket.on('error', () => undefined)
  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8')
    while (pending.length > 0) {
      if (body !== undefined) {
        body = collect(socket, log, body + pending)
        pending = ''
        return
      }
      const end = pending.indexOf('\r\n')
      if (end < 0) {
        return
      }
      const line = pending.slice(0, end)
      pending = pending.slice(end + 2)
      record(log, line)
      if (/^EHLO/iu.test(line)) {
        socket.write(certificate ? '250-relay\r\n250 STARTTLS\r\n' : '250 relay\r\n')
      } else if (/^STARTTLS/iu.test(line) && certificate) {
        socket.write('220 go ahead\r\n')
        onStarttls?.()
        socket.removeAllListeners('data')
        converse(
          sealed(new tls.TLSSocket(socket, { isServer: true, ...certificate })),
          log,
          undefined
        )
        return
      } else if (/^DATA/iu.test(line)) {
        body = ''
        socket.write('354 go\r\n')
      } else if (/^QUIT/iu.test(line)) {
        socket.end('221 bye\r\n')
      } else {
        socket.write('250 ok\r\n')
      }
    }
  })
}

/**
 * Starts a relay on a free local port.
 *
 * @param options - `implicitTls` serves TLS from the first byte; `starttls` offers STARTTLS. Both
 *   take the certificate to serve.
 * @returns The relay, with what it saw.
 */
export async function startRelay(
  options: {
    certificate?: TestCertificate
    implicitTls?: boolean
    /** Runs when a client has connected, just before the relay greets it. */
    onConnect?: () => void
    /** Runs when the relay has agreed to a STARTTLS upgrade, before the handshake. */
    onStarttls?: () => void
  } = {}
): Promise<Relay> {
  const log: RelayLog = { commands: [], messages: [], servernames: [], envelope: [] }
  const onSocket = (socket: net.Socket): void => {
    options.onConnect?.()
    socket.write('220 relay ready\r\n')
    converse(
      sealed(socket),
      log,
      options.implicitTls ? undefined : options.certificate,
      options.onStarttls
    )
  }
  const server =
    options.implicitTls && options.certificate
      ? tls.createServer(
          {
            ...options.certificate,
            // Picks the certificate by name, as a relay that hosts several does, and records the name.
            SNICallback: (name, done) => {
              log.servernames.push(name)
              done(null, tls.createSecureContext(options.certificate))
            }
          },
          onSocket
        )
      : net.createServer(onSocket)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    ...log,
    port: (server.address() as net.AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
