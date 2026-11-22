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
        'subjectAltName=IP:127.0.0.1',
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

/** Answers the SMTP conversation on one socket, upgrading it on STARTTLS when it has a certificate. */
function converse(
  socket: net.Socket,
  log: RelayLog,
  certificate: TestCertificate | undefined
): void {
  let body: string | undefined
  let pending = ''
  socket.on('error', () => undefined)
  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8')
    while (pending.length > 0) {
      if (body !== undefined) {
        body += pending
        pending = ''
        if (body.endsWith('\r\n.\r\n')) {
          log.messages.push(body)
          body = undefined
          socket.write('250 queued\r\n')
        }
        return
      }
      const end = pending.indexOf('\r\n')
      if (end < 0) {
        return
      }
      const line = pending.slice(0, end)
      pending = pending.slice(end + 2)
      log.commands.push(line.split(' ')[0]?.toUpperCase() ?? '')
      if (/^EHLO/iu.test(line)) {
        socket.write(certificate ? '250-relay\r\n250 STARTTLS\r\n' : '250 relay\r\n')
      } else if (/^STARTTLS/iu.test(line) && certificate) {
        socket.write('220 go ahead\r\n')
        socket.removeAllListeners('data')
        converse(new tls.TLSSocket(socket, { isServer: true, ...certificate }), log, undefined)
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
  options: { certificate?: TestCertificate; implicitTls?: boolean } = {}
): Promise<Relay> {
  const log: RelayLog = { commands: [], messages: [] }
  const onSocket = (socket: net.Socket): void => {
    socket.write('220 relay ready\r\n')
    converse(socket, log, options.implicitTls ? undefined : options.certificate)
  }
  const server =
    options.implicitTls && options.certificate
      ? tls.createServer(options.certificate, onSocket)
      : net.createServer(onSocket)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    ...log,
    port: (server.address() as net.AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
