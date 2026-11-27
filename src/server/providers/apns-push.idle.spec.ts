/**
 * @fileoverview What the APNs adapter does with a connection that has been idle, a NAT drop included.
 * @layer infrastructure
 */

import { connect } from 'node:http2'
import { connect as dial, createServer } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'

import { ApnsPushProvider } from './apns-push.provider'
import {
  OTHER,
  THIRD,
  TOKEN,
  base,
  cleanup,
  credentials,
  fake,
  providerOn
} from './__tests__/apns-server.fixture'
import type { Fake, Step } from './__tests__/apns-server.fixture'

/** A TCP relay to the fake server that can forget the connections it holds, as a NAT does. */
async function natTo(server: Fake) {
  const probe = server.connect('probe')
  await new Promise<void>((done) => probe.once('connect', () => done()))
  const port = (probe.socket as Socket).remotePort as number
  probe.destroy()
  const held: { forgotten: boolean }[] = []
  const sockets: Socket[] = []
  const relay = createServer((client) => {
    const state = { forgotten: false }
    held.push(state)
    const upstream = dial(port, '127.0.0.1')
    sockets.push(client, upstream)
    client.on('error', () => undefined)
    upstream.on('error', () => undefined)
    upstream.on('data', (data) => client.write(data))
    // A forgotten connection answers the next bytes with a reset and passes none of them on.
    client.on('data', (data) => {
      if (state.forgotten) {
        client.resetAndDestroy()
        upstream.destroy()
      } else {
        upstream.write(data)
      }
    })
  })
  await new Promise<void>((done) => relay.listen(0, '127.0.0.1', done))
  const authority = `http://127.0.0.1:${String((relay.address() as AddressInfo).port)}`
  return {
    connect: () => connect(authority),
    forget: () => held.forEach((state) => (state.forgotten = true)),
    close: async () => {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((done) => relay.close(() => done()))
    }
  }
}

const connections = (server: Fake): number[] => server.requests.map((one) => one.connection)

describe('ApnsPushProvider, an idle connection', () => {
  afterEach(cleanup)

  it('delivers after a NAT forgot the connection while it was idle', async () => {
    /* Arrange */
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const server = await fake()
    const nat = await natTo(server)
    const provider = new ApnsPushProvider({ ...credentials, connect: nat.connect })
    await provider.send({ ...base, tokens: TOKEN })
    nat.forget()
    clock.mockReturnValue(1_060_000)
    /* Act */
    const result = await provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] })
    provider.close()
    await nat.close()
    /* Assert */
    expect(result.results.map((one) => one.reason)).toEqual([undefined, undefined, undefined])
  }, 5_000)

  it.each([
    ['keeps a connection idle for less than 60 seconds', 59_999, true],
    ['replaces one idle for 60 seconds', 60_000, false]
  ])('%s', async (_case, idle, same) => {
    /* Arrange */
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const server = await fake()
    const provider = providerOn(server)
    await provider.send({ ...base, tokens: TOKEN })
    clock.mockReturnValue(1_000_000 + idle)
    /* Act */
    await provider.send({ ...base, tokens: TOKEN })
    /* Assert */
    expect(connections(server)[0] === connections(server)[1]).toBe(same)
  })

  it('counts the idle time from the end of the last request', async () => {
    /* Arrange */
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const server = await fake()
    server.steps.push((seen) => {
      clock.mockReturnValue(1_090_000)
      seen.stream.respond({ ':status': 200, 'apns-id': 'slow' })
      seen.stream.end()
    })
    const provider = providerOn(server)
    await provider.send({ ...base, tokens: TOKEN })
    clock.mockReturnValue(1_149_999)
    /* Act */
    await provider.send({ ...base, tokens: TOKEN })
    /* Assert */
    expect(connections(server)).toEqual([0, 0])
  })

  it('keeps a connection that has a request open, however long it has been', async () => {
    /* Arrange */
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const server = await fake()
    const provider = providerOn(server)
    await provider.send({ ...base, tokens: TOKEN })
    let release = (): void => undefined
    const arrived = new Promise<void>((seenIt) => {
      server.steps.push((seen) => {
        release = () => {
          seen.stream.respond({ ':status': 200, 'apns-id': 'held' })
          seen.stream.end()
        }
        seenIt()
      })
    })
    const held = provider.send({ ...base, tokens: OTHER })
    await arrived
    clock.mockReturnValue(2_000_000)
    /* Act */
    await provider.send({ ...base, tokens: THIRD })
    release()
    await held
    /* Assert */
    expect(connections(server)).toEqual([0, 0, 0])
  })

  it('sends one request first on the connection that replaces an idle one', async () => {
    /* Arrange */
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const server = await fake()
    const provider = providerOn(server)
    await provider.send({ ...base, tokens: TOKEN })
    clock.mockReturnValue(1_060_000)
    const refused: Step = { status: 403, reason: 'InvalidProviderToken' }
    server.steps.push(refused, refused, refused)
    /* Act */
    await provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] }).catch(() => undefined)
    /* Assert */
    expect(server.requests).toHaveLength(2)
  })
})
