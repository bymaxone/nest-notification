/**
 * @fileoverview Holds the guarded connection to what Nodemailer and the TLS layer need of a socket,
 * and to its one rule: nothing is written while the realm root holds a key that is not standard.
 * @layer infrastructure
 */

import * as net from 'node:net'

import { GuardedConnection } from './smtp-guarded-connection'

let server: net.Server
let inner: net.Socket
let received: Buffer[]
let serverSide: net.Socket | undefined

beforeEach(async () => {
  received = []
  serverSide = undefined
  server = net.createServer((socket) => {
    serverSide = socket
    socket.on('data', (chunk) => received.push(chunk))
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  inner = net.connect((server.address() as net.AddressInfo).port, '127.0.0.1')
  await new Promise<void>((resolve) => inner.once('connect', resolve))
  await new Promise((resolve) => setTimeout(resolve, 20))
})

afterEach(async () => {
  Reflect.deleteProperty(Object.prototype, 'planted')
  inner.destroy()
  serverSide?.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

function plant(): void {
  Object.defineProperty(Object.prototype, 'planted', {
    value: 1,
    configurable: true,
    writable: true
  })
}

describe('GuardedConnection', () => {
  it('should write what it is given to the socket underneath', async () => {
    const connection = new GuardedConnection(inner)

    connection.write('EHLO test\r\n')
    await settle()

    expect(Buffer.concat(received).toString()).toBe('EHLO test\r\n')
  })

  it('should pass on what the peer sends, and pause the socket underneath when the reader is behind', async () => {
    const connection = new GuardedConnection(inner)
    const pause = jest.spyOn(inner, 'pause')
    const chunk = Buffer.alloc(64 * 1024, 1)

    for (let index = 0; index < 40; index += 1) {
      serverSide?.write(chunk)
    }
    await settle()

    expect(pause).toHaveBeenCalled()
    expect(connection.readableLength).toBeGreaterThan(0)
  })

  it('should end the socket underneath when it is ended', async () => {
    const connection = new GuardedConnection(inner)
    const closed = new Promise<void>((resolve) => connection.once('finish', resolve))

    connection.end('QUIT\r\n')
    await closed
    await settle()

    expect(Buffer.concat(received).toString()).toBe('QUIT\r\n')
    expect(inner.writableEnded).toBe(true)
  })

  it('should answer for the addresses of the socket underneath', () => {
    const connection = new GuardedConnection(inner)

    expect([
      connection.remoteAddress,
      connection.remotePort,
      connection.localAddress,
      connection.localPort
    ]).toStrictEqual([inner.remoteAddress, inner.remotePort, inner.localAddress, inner.localPort])
  })

  it('should set the timeout of the socket underneath and forward its timeout event', async () => {
    const connection = new GuardedConnection(inner)
    const listener = jest.fn()

    const returned = connection.setTimeout(20, listener)
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(returned).toBe(connection)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should set a timeout without a listener', () => {
    const connection = new GuardedConnection(inner)

    expect(connection.setTimeout(0)).toBe(connection)
  })

  it('should end, destroy and report an error of the socket underneath', async () => {
    const connection = new GuardedConnection(inner)
    const failure = new Promise<Error>((resolve) => connection.once('error', resolve))

    inner.destroy(new Error('reset'))

    expect((await failure).message).toBe('reset')
    expect(connection.destroyed).toBe(true)
  })

  it('should end when the peer closes', async () => {
    const connection = new GuardedConnection(inner)
    const ended = new Promise<void>((resolve) => connection.once('end', resolve))
    connection.resume()

    serverSide?.end()

    await ended
    expect(connection.readableEnded).toBe(true)
  })

  it('should destroy the socket underneath when it is destroyed', async () => {
    const connection = new GuardedConnection(inner)

    connection.destroy()
    await settle()

    expect(inner.destroyed).toBe(true)
  })

  it('should refuse a write while the root is polluted, destroy the socket and send nothing', async () => {
    const connection = new GuardedConnection(inner)
    const failure = new Promise<{ code?: string }>((resolve) => connection.once('error', resolve))
    plant()

    connection.write('MAIL FROM:<a@b.c>\r\n')

    expect((await failure).code).toBe('notification.invalid_scope_identifier')
    expect(inner.destroyed).toBe(true)
    expect(Buffer.concat(received)).toHaveLength(0)
  })

  it('should refuse an end while the root is polluted', async () => {
    const connection = new GuardedConnection(inner)
    const failure = new Promise<{ code?: string }>((resolve) => connection.once('error', resolve))
    plant()

    connection.end()

    expect((await failure).code).toBe('notification.invalid_scope_identifier')
    expect(inner.destroyed).toBe(true)
  })
})
