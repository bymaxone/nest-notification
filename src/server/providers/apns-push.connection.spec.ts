/**
 * @fileoverview What the APNs adapter concludes about a connection from how its requests end.
 * @layer infrastructure
 */

import { constants } from 'node:http2'
import type { ClientHttp2Session } from 'node:http2'

import { ApnsPushProvider } from './apns-push.provider'
import {
  OTHER,
  THIRD,
  TOKEN,
  answer,
  base,
  cleanup,
  credentials,
  fake,
  providerOn
} from './__tests__/apns-server.fixture'
import type { Fake, Seen, Step } from './__tests__/apns-server.fixture'

const refusedStream: Step = (seen) => seen.stream.close(constants.NGHTTP2_REFUSED_STREAM)

/** A connect that records the sessions it gave. */
function recording(server: Fake) {
  const sessions: ClientHttp2Session[] = []
  const connect = (authority: string): ClientHttp2Session => {
    const session = server.connect(authority)
    sessions.push(session)
    return session
  }
  return { sessions, connect }
}

/** A step that holds its request, and the request once the server has read it. */
function holding(): { step: Step; arrived: Promise<Seen> } {
  let step: Step = () => undefined
  const arrived = new Promise<Seen>((done) => {
    step = (seen) => done(seen)
  })
  return { step, arrived }
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

describe('ApnsPushProvider, what a connection is taken to be', () => {
  afterEach(cleanup)

  it('goes on with the batch after a stream refused on a connection that was made', async () => {
    /* Arrange */
    const server = await fake()
    server.steps.push(refusedStream)
    /* Act */
    const result = await providerOn(server).send({ ...base, tokens: [TOKEN, OTHER] })
    /* Assert */
    expect(result.results[1]?.messageId).toBe('id-cd')
  }, 5_000)

  it('knows a session the host gave already connected as one that was made', async () => {
    /* Arrange */
    const server = await fake()
    const ready = server.connect('https://api.push.apple.com')
    await new Promise<void>((done) => ready.once('connect', () => done()))
    server.steps.push(refusedStream)
    const provider = providerOn(server, { connect: () => ready })
    /* Act */
    const result = await provider.send({ ...base, tokens: [TOKEN, OTHER] })
    /* Assert */
    expect(result.results[1]?.messageId).toBe('id-cd')
  }, 5_000)

  it('stops a batch at the first connect that throws', async () => {
    /* Arrange */
    const connect = jest.fn((): ClientHttp2Session => {
      throw new Error('proxy')
    })
    const provider = new ApnsPushProvider({ ...credentials, connect })
    /* Act */
    await provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] }).catch(() => undefined)
    /* Assert */
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('goes on after a request that a connected session refused to open', async () => {
    /* Arrange */
    const server = await fake()
    const ready = server.connect('https://api.push.apple.com')
    await new Promise<void>((done) => ready.once('connect', () => done()))
    jest.spyOn(ready, 'request').mockImplementationOnce(() => {
      throw new Error('no stream')
    })
    let given = false
    const connect = (authority: string): ClientHttp2Session => {
      const session = given ? server.connect(authority) : ready
      given = true
      return session
    }
    /* Act */
    const result = await providerOn(server, { connect }).send({ ...base, tokens: [TOKEN, OTHER] })
    /* Assert */
    expect(result.results.map((r) => r.messageId)).toEqual([undefined, 'id-cd'])
  }, 5_000)

  it('goes on with a batch that waited behind a request that got no answer', async () => {
    /* Arrange */
    const server = await fake()
    server.steps.push(() => undefined)
    const provider = providerOn(server, { timeoutMs: 150 })
    /* Act */
    const first = provider.send({ ...base, tokens: TOKEN })
    const second = await provider.send({ ...base, tokens: [OTHER, THIRD] })
    await first
    /* Assert */
    expect(second.results.map((r) => r.messageId)).toEqual([undefined, 'id-ef'])
  }, 5_000)

  it('does not count a connection as accepted on a refused request', async () => {
    /* Arrange */
    const server = await fake()
    const refused: Step = { status: 403, reason: 'InvalidProviderToken' }
    server.steps.push({ status: 400, reason: 'BadDeviceToken' }, refused, refused, refused)
    const provider = providerOn(server)
    await provider.send({ ...base, tokens: TOKEN })
    /* Act */
    await provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] }).catch(() => undefined)
    /* Assert */
    expect(server.requests).toHaveLength(2)
  }, 5_000)

  it('reads the reason of an answer that arrives in parts', async () => {
    /* Arrange */
    const server = await fake()
    server.steps.push((seen) => {
      seen.stream.respond({ ':status': 400 })
      seen.stream.write('{"reason":')
      setTimeout(() => seen.stream.end('"BadDeviceToken"}'), 30)
    })
    /* Act */
    const result = await providerOn(server).send({ ...base, tokens: TOKEN })
    /* Assert */
    expect(result.results[0]?.reason).toBe('token_invalid')
  }, 5_000)

  it('cancels an answer that goes over the bound, without waiting for it to end', async () => {
    /* Arrange: the answer never ends, and the request bound is longer than the test's */
    const server = await fake()
    let reset: Promise<number | undefined> | undefined
    server.steps.push((seen) => {
      reset = new Promise((done) => seen.stream.on('close', () => done(seen.stream.rstCode)))
      seen.stream.respond({ ':status': 400 })
      seen.stream.write(`{"reason":"BadDeviceToken","pad":"${'x'.repeat(70_000)}`)
    })
    /* Act */
    const result = await providerOn(server, { timeoutMs: 30_000 }).send({ ...base, tokens: TOKEN })
    /* Assert */
    expect(result.results[0]?.reason).toBe('unknown')
    expect(await reset).toBe(constants.NGHTTP2_CANCEL)
  }, 5_000)

  it('repeats an expired token once, however late the second refusal comes', async () => {
    /* Arrange: the clock moves 25 minutes before each of the two refusals is read */
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0)
    const server = await fake()
    const provider = providerOn(server)
    await provider.send({ ...base, tokens: TOKEN })
    const expiredAt =
      (at: number): Step =>
      (seen) => {
        clock.mockReturnValue(at)
        answer(seen, { status: 403, reason: 'ExpiredProviderToken' })
      }
    server.steps.push(expiredAt(25 * 60_000), expiredAt(50 * 60_000))
    /* Act */
    await provider.send({ ...base, tokens: OTHER }).catch(() => undefined)
    /* Assert */
    expect(server.requests).toHaveLength(3)
  }, 5_000)

  it('lets the other request of a timed-out connection finish, and puts new ones elsewhere', async () => {
    /* Arrange: two requests held on one connection, the second sent later than the first */
    const server = await fake()
    const { sessions, connect } = recording(server)
    const provider = providerOn(server, { connect, timeoutMs: 600 })
    await provider.send({ ...base, tokens: TOKEN })
    const first = holding()
    const other = holding()
    server.steps.push(first.step, other.step)
    const timesOut = provider.send({ ...base, tokens: OTHER })
    await first.arrived
    await pause(300)
    const finishes = provider.send({ ...base, tokens: THIRD })
    const held = await other.arrived
    await timesOut
    await pause(30)
    /* Act */
    const openWhileOneRuns = sessions[0]?.closed === false
    await provider.send({ ...base, tokens: TOKEN })
    answer(held, { status: 200 })
    const finished = await finishes
    /* Assert */
    expect(openWhileOneRuns).toBe(true)
    expect(finished.results[0]?.messageId).toBe('id-ef')
    expect(server.requests.map((r) => r.connection)).toEqual([0, 0, 0, 1])
    expect(sessions[0]?.closed).toBe(true)
  }, 5_000)

  it('keeps the newer connection when a second request of an older one times out', async () => {
    /* Arrange */
    const server = await fake()
    const provider = providerOn(server, { timeoutMs: 600 })
    await provider.send({ ...base, tokens: TOKEN })
    const first = holding()
    const other = holding()
    server.steps.push(first.step, other.step)
    const one = provider.send({ ...base, tokens: OTHER })
    await first.arrived
    await pause(300)
    const two = provider.send({ ...base, tokens: THIRD })
    await other.arrived
    await one
    await provider.send({ ...base, tokens: TOKEN })
    await two
    /* Act */
    await provider.send({ ...base, tokens: TOKEN })
    /* Assert */
    expect(server.requests.map((r) => r.connection)).toEqual([0, 0, 0, 1, 1])
  }, 5_000)
})
