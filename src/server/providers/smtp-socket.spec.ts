/**
 * @fileoverview Holds the adapter's own socket to what it promises: it answers once, with the socket
 * when it connects and with an error that carries the code and the words of a timeout when it does
 * not; it refuses, naming the adapter, while the realm root holds a key that is not standard.
 * @layer infrastructure
 */

import * as net from 'node:net'

import { makeCertificate, startRelay } from './__tests__/smtp-relay.fixture'
import { smtpGetSocket } from './smtp-socket'

type Answer = Parameters<ReturnType<typeof smtpGetSocket>>[1]

let server: net.Server | undefined

afterEach(async () => {
  Reflect.deleteProperty(Object.prototype, 'planted')
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = undefined
})

async function listen(onSocket: (socket: net.Socket) => void): Promise<number> {
  server = net.createServer(onSocket)
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  return (server.address() as net.AddressInfo).port
}

function open(
  port: number,
  extra: { secure?: boolean; timeoutMs?: number } = {}
): Promise<unknown[]> {
  return new Promise((resolve) => {
    const answers: unknown[][] = []
    const answer: Answer = (...args) => {
      answers.push(args)
    }
    smtpGetSocket({
      host: '127.0.0.1',
      port,
      secure: extra.secure ?? false,
      tls: undefined,
      connectionTimeoutMs: extra.timeoutMs ?? 1000
    })(undefined, answer)
    setTimeout(() => resolve(answers), 400)
  })
}

describe('smtpGetSocket', () => {
  it('should answer once with the open socket and say whether TLS is on it', async () => {
    const port = await listen((socket) => socket.resume())

    const answers = await open(port)

    expect(answers).toHaveLength(1)
    const [error, socket] = answers[0] as [unknown, { connection: net.Socket; secured: boolean }]
    expect(error).toBeNull()
    expect(socket.secured).toBe(false)
    socket.connection.destroy()
  })

  it('should not answer again when the socket fails after it connected', async () => {
    const port = await listen((socket) => socket.resume())
    const answers: unknown[][] = []
    const answer: Answer = (...args) => {
      answers.push(args)
    }
    smtpGetSocket({
      host: '127.0.0.1',
      port,
      secure: false,
      tls: undefined,
      connectionTimeoutMs: 1000
    })(undefined, answer)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const connection = (answers[0]?.[1] as { connection: net.Socket }).connection
    connection.on('error', () => undefined)

    connection.emit('error', new Error('after'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(answers).toHaveLength(1)
    connection.destroy()
  })

  it('should not answer again when the peer resets the socket after it connected', async () => {
    let peer: net.Socket | undefined
    const port = await listen((socket) => {
      peer = socket
      socket.on('error', () => undefined)
      socket.resume()
    })
    const answers: unknown[][] = []
    const answer: Answer = (...args) => {
      answers.push(args)
    }
    smtpGetSocket({
      host: '127.0.0.1',
      port,
      secure: false,
      tls: undefined,
      connectionTimeoutMs: 1000
    })(undefined, answer)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const connection = (answers[0]?.[1] as { connection: net.Socket }).connection
    connection.on('error', () => undefined)

    peer?.resetAndDestroy()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(answers).toHaveLength(1)
    connection.destroy()
  })

  it('should answer a handshake that never completes with a timeout error that has its code and words', async () => {
    const port = await listen((socket) => socket.resume())

    const answers = await open(port, { secure: true, timeoutMs: 30 })

    expect(answers).toHaveLength(1)
    const error = (answers[0] as [Error])[0]
    expect(error.message).toBe('Connection timeout')
    expect((error as { code?: string }).code).toBe('ETIMEDOUT')
  })

  it('should refuse, naming the adapter, while the realm root holds a key that is not standard', async () => {
    const port = await listen((socket) => socket.resume())
    Object.defineProperty(Object.prototype, 'planted', {
      value: 1,
      configurable: true,
      writable: true
    })

    const answers = await open(port)

    const error = (answers[0] as [{ getResponse(): unknown }])[0]
    expect(error.getResponse()).toMatchObject({
      error: { details: { boundary: 'SmtpEmailProvider' } }
    })
  })

  it('should read a tls value that is undefined as not set, so the hostname is still the SNI name', async () => {
    const certificate = makeCertificate()
    const relay = await startRelay({ certificate, implicitTls: true })
    const answers: unknown[][] = []
    const answer: Answer = (...args) => {
      answers.push(args)
    }

    smtpGetSocket({
      host: 'localhost',
      port: relay.port,
      secure: true,
      tls: { ca: certificate.cert, servername: undefined },
      connectionTimeoutMs: 2000
    })(undefined, answer)
    await new Promise((resolve) => setTimeout(resolve, 400))
    ;(answers[0]?.[1] as { connection: net.Socket } | undefined)?.connection.destroy()
    await relay.close()

    expect(relay.servernames).toStrictEqual(['localhost'])
  })

  it('should destroy the connection with the refusal when it is ended while the root is polluted', async () => {
    const port = await listen((socket) => socket.resume())
    const answers: unknown[][] = []
    const answer: Answer = (...args) => {
      answers.push(args)
    }
    smtpGetSocket({
      host: '127.0.0.1',
      port,
      secure: false,
      tls: undefined,
      connectionTimeoutMs: 1000
    })(undefined, answer)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const connection = (answers[0]?.[1] as { connection: net.Socket }).connection
    const closed = new Promise<Error | undefined>((resolve) => {
      connection.once('error', (error: Error) => resolve(error))
    })
    Object.defineProperty(Object.prototype, 'planted', {
      value: 1,
      configurable: true,
      writable: true
    })

    connection.end('QUIT\r\n')

    expect(await closed).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should not take its write and end from a bind that was replaced while the socket opened', async () => {
    // The Function.prototype of the realm Node's own methods belong to: the jest sandbox has its own.
    const nodeFunctions = Object.getPrototypeOf(net.Socket.prototype.write) as Function
    const originalBind = nodeFunctions.bind
    const write = net.Socket.prototype.write
    const end = net.Socket.prototype.end
    let handedOut = 0
    const port = await listen((socket) => socket.resume())
    // Replaced in the realm Node's sockets belong to, so the jest sandbox's own check does not see it.
    nodeFunctions.bind = function (this: unknown, thisArg: unknown, ...bound: unknown[]) {
      if (this === write || this === end) {
        handedOut += 1
        return () => true
      }
      return Reflect.apply(originalBind, this, [thisArg, ...bound]) as never
    } as typeof Function.prototype.bind
    const answers: unknown[][] = []
    const answer: Answer = (...args) => {
      answers.push(args)
    }
    smtpGetSocket({
      host: '127.0.0.1',
      port,
      secure: false,
      tls: undefined,
      connectionTimeoutMs: 1000
    })(undefined, answer)
    await new Promise((resolve) => setTimeout(resolve, 100))
    nodeFunctions.bind = originalBind
    const connection = (answers[0]?.[1] as { connection: net.Socket }).connection

    connection.write('MAIL FROM:<x@y.z>\r\n')
    connection.destroy()

    expect(handedOut).toBe(0)
  })
})
