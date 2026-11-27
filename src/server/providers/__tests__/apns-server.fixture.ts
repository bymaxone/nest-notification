/**
 * @fileoverview A local HTTP/2 server that stands for APNs in the specs of the adapter.
 * @layer infrastructure
 */

import { generateKeyPairSync } from 'node:crypto'
import { connect, createServer } from 'node:http2'
import type {
  ClientHttp2Session,
  Http2Server,
  IncomingHttpHeaders,
  ServerHttp2Session,
  ServerHttp2Stream,
  Settings
} from 'node:http2'
import type { AddressInfo } from 'node:net'

import type { PushSendOptions } from '../../interfaces/push-provider.interface'
import { ApnsPushProvider } from '../apns-push.provider'
import type { ApnsPushProviderOptions } from '../apns-push.provider'

/** A P-256 key pair made for one run of a spec. */
export const KEYS = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
/** Complete provider options; the team and key ids are values a spec can search errors for. */
export const credentials = {
  teamId: 'TEAMSECRET',
  keyId: 'KEYSECRET1',
  privateKey: KEYS.privateKey,
  topic: 'com.example.app',
  environment: 'production' as const
}
/** The smallest message. */
export const base = { title: 't', body: 'b' }
/** A device token. */
export const TOKEN = 'ab'.repeat(32)
/** A second device token. */
export const OTHER = 'cd'.repeat(32)
/** A third device token. */
export const THIRD = 'ef'.repeat(32)

/** One request as the server read it. */
export interface Seen {
  headers: IncomingHttpHeaders
  body: string
  stream: ServerHttp2Stream
  connection: number
}

/** What the server does with one request: a scripted answer, or a function that takes it over. */
export type Step =
  | { status: number; reason?: string; text?: string; apnsId?: string | null }
  | ((seen: Seen) => void)

/** What a spec holds of a running server. */
export interface Fake {
  readonly requests: Seen[]
  readonly authorities: string[]
  readonly steps: Step[]
  readonly sessions: ServerHttp2Session[]
  connect: (authority: string) => ClientHttp2Session
  close: () => Promise<void>
}

const servers: Fake[] = []
const providers: ApnsPushProvider[] = []

/** Answers one request; without an `apnsId` the answer names the start of the device token. */
export function answer(seen: Seen, step: Exclude<Step, (seen: Seen) => void>): void {
  const headers: Record<string, string | number> = { ':status': step.status }
  if (step.apnsId !== null) {
    headers['apns-id'] = step.apnsId ?? `id-${String(seen.headers[':path']).slice(10, 12)}`
  }
  seen.stream.respond(headers)
  seen.stream.end(
    step.text ?? (step.reason === undefined ? '' : JSON.stringify({ reason: step.reason }))
  )
}

/** Reads one request whole, then answers it with the next step of the script. */
function receive(sessions: ServerHttp2Session[], requests: Seen[], steps: Step[]) {
  return (stream: ServerHttp2Stream, headers: IncomingHttpHeaders): void => {
    let body = ''
    stream.on('error', () => undefined)
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => (body += chunk))
    stream.on('end', () => {
      const seen = {
        headers,
        body,
        stream,
        connection: sessions.indexOf(stream.session as ServerHttp2Session)
      }
      requests.push(seen)
      const step = steps.shift() ?? { status: 200 }
      if (typeof step === 'function') {
        step(seen)
      } else {
        answer(seen, step)
      }
    })
  }
}

/** A local HTTP/2 server that answers from a script, 200 once the script is spent. */
export async function fake(settings: Settings = {}): Promise<Fake> {
  const requests: Seen[] = []
  const authorities: string[] = []
  const steps: Step[] = []
  const sessions: ServerHttp2Session[] = []
  const clients: ClientHttp2Session[] = []
  const server: Http2Server = createServer({ settings })
  server.on('session', (session) => {
    sessions.push(session)
    session.on('error', () => undefined)
  })
  server.on('stream', receive(sessions, requests, steps))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as AddressInfo).port
  const made: Fake = {
    requests,
    authorities,
    steps,
    sessions,
    connect: (authority) => {
      authorities.push(authority)
      const client = connect(`http://127.0.0.1:${String(port)}`)
      clients.push(client)
      return client
    },
    close: async () => {
      clients.forEach((client) => client.destroy())
      sessions.forEach((session) => session.destroy())
      await new Promise<void>((done) => server.close(() => done()))
    }
  }
  servers.push(made)
  return made
}

/** A provider connected to the server, closed by `cleanup`. */
export function providerOn(
  server: Fake,
  extra: Partial<ApnsPushProviderOptions> = {}
): ApnsPushProvider {
  const provider = new ApnsPushProvider({ ...credentials, connect: server.connect, ...extra })
  providers.push(provider)
  return provider
}

/** Sends one message and returns the last request the server read. */
export async function sendOne(server: Fake, options: Partial<PushSendOptions> = {}): Promise<Seen> {
  await providerOn(server).send({ ...base, tokens: TOKEN, ...options })
  return server.requests[server.requests.length - 1] as Seen
}

/** The error a promise rejects with; throws when it resolves. */
export async function failureOf(pending: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await pending
  } catch (error) {
    return error as Error & { code?: string }
  }
  throw new Error('the call was expected to reject')
}

/** The provider token of a request, with its decoded header and claims. */
export function claimsOf(request: Seen): {
  token: string
  header: object
  claims: { iat: number; iss: string }
} {
  const token = String(request.headers.authorization).replace('bearer ', '')
  const [header, claims] = token
    .split('.')
    .slice(0, 2)
    .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()))
  return { token, header, claims }
}

/** Closes every provider and server a test opened. */
export async function cleanup(): Promise<void> {
  providers.splice(0).forEach((provider) => provider.close())
  await Promise.all(servers.splice(0).map((server) => server.close()))
  jest.restoreAllMocks()
}
