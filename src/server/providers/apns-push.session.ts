/**
 * @fileoverview The HTTP/2 connection to APNs: one session reused, and one request answered as data
 * and never as an exception.
 * @layer infrastructure
 *
 * APNs allows one stream on a connection it has not authenticated yet, and Node submits what is pending
 * before it knows the peer's limit. So until a connection has had an answer, one request is in flight on
 * it and the others wait; if that one gets no answer, those that waited are returned as not sent.
 *
 * A request that got no status says whether APNs can have seen it: not when its stream never had an
 * id, was refused with `REFUSED_STREAM`, or is above the last stream a `GOAWAY` names.
 *
 * A NAT or a firewall can forget a quiet connection without either end hearing of it, and a request
 * written to it is lost with no way to tell whether APNs saw it. So a connection that has had no request
 * open for {@link IDLE_LIMIT_MS} is replaced before anything is written to it.
 */

import { connect, constants } from 'node:http2'
import type { ClientHttp2Session, ClientHttp2Stream, IncomingHttpHeaders } from 'node:http2'

import { boundedChunks } from '../utils/bounded-body'
import { OUTCOME_UNKNOWN, UNREACHABLE, field } from '../utils/push-outcome'
import type { PushFailure } from '../utils/push-outcome'
import { assertStandardRealmRoot, checkedAwait, newPromise } from '../utils/realm-root'

// Read once, when the module loads: a later replacement of the built-in changes nothing here.
const connectTo = connect
const parseJson = JSON.parse
const { NGHTTP2_CANCEL, NGHTTP2_REFUSED_STREAM } = constants

/** The most bytes of an answer that are accepted. */
const ANSWER_LIMIT = 65_536

/** How long a session may have no request open and still be used. */
const IDLE_LIMIT_MS = 60_000

/** Opens a session to an origin; `http2.connect` by default, a host's own to go through a proxy. */
export type ApnsConnect = (authority: string) => ClientHttp2Session

/** An answer, or a request that got none. */
export type ApnsCall =
  | {
      readonly kind: 'answer'
      readonly status: number
      readonly apnsId: string | undefined
      readonly reason: string | undefined
    }
  | {
      readonly kind: 'lost'
      readonly failure: PushFailure
      /** Whether the session never connected, so the next request would not either. */
      readonly neverConnected: boolean
    }

/** What is known of one session. */
interface Link {
  readonly session: ClientHttp2Session
  connected: boolean
  /** Whether APNs has accepted a request on it. */
  proven: boolean
  /** Whether any request on it has had a status. */
  answered: boolean
  /** How many requests on it are not yet over. */
  open: number
  /** When the session was opened or its last request ended, by `Date.now`. */
  quietSince: number
  /** Set once it takes no more requests; it is ended when none is left open. */
  retired: boolean
  /** The request the others wait for, while none has had a status. */
  lead?: Promise<ApnsCall> | undefined
  /** The last stream id of a `GOAWAY`, once one arrived. */
  lastStreamId?: number
}

/** What has arrived of one answer. */
interface Answer {
  status?: number
  apnsId?: string
  readonly chunks: ReturnType<typeof boundedChunks>
}

/** The `reason` of a refusal body, when it has one. */
function reasonOf(text: string): string | undefined {
  try {
    const reason = field(parseJson(text) as unknown, 'reason')
    return typeof reason === 'string' ? reason : undefined
  } catch {
    return undefined
  }
}

/** Reads how a request ended. */
function ended(link: Link, stream: ClientHttp2Stream, answer: Answer): ApnsCall {
  const { status, apnsId } = answer
  if (status !== undefined) {
    link.proven ||= status === 200
    link.answered = true
    return { kind: 'answer', status, apnsId, reason: reasonOf(answer.chunks.text()) }
  }
  const id = stream.id
  const unseen =
    id === undefined ||
    stream.rstCode === NGHTTP2_REFUSED_STREAM ||
    (link.lastStreamId !== undefined && id > link.lastStreamId)
  return {
    kind: 'lost',
    failure: unseen ? UNREACHABLE : OUTCOME_UNKNOWN,
    neverConnected: !link.connected
  }
}

/** Collects the answer of a stream. */
function collect(stream: ClientHttp2Stream): Answer {
  const answer: Answer = { chunks: boundedChunks(ANSWER_LIMIT) }
  stream.on('response', (headers: IncomingHttpHeaders) => {
    answer.status = Number(headers[':status'])
    const apnsId = headers['apns-id']
    if (typeof apnsId === 'string') {
      answer.apnsId = apnsId
    }
  })
  stream.on('data', (chunk: Buffer) => {
    if (!answer.chunks.add(chunk)) {
      stream.close(NGHTTP2_CANCEL)
    }
  })
  // Every failure ends in `close`, which reads what happened.
  stream.on('error', () => undefined)
  return answer
}

/** Follows a new session. */
function follow(session: ClientHttp2Session): Link {
  // A host's `connect` may give a session that is already connected, which says so only here.
  const connected = session.connecting === false && !session.destroyed
  const link: Link = {
    session,
    connected,
    proven: false,
    answered: false,
    open: 0,
    quietSince: Date.now(),
    retired: false
  }
  session.on('connect', () => {
    link.connected = true
  })
  session.on('goaway', (_code: number, lastStreamId: number) => {
    link.lastStreamId = lastStreamId
  })
  // The streams of a failed session report it themselves.
  session.on('error', () => undefined)
  // An idle connection never keeps the process running; a request in flight has its timer.
  session.unref()
  return link
}

/** Takes no more requests on a link, and ends its session once none is left open. */
function retire(link: Link): void {
  link.retired = true
  if (link.open === 0) {
    // Not before: a session closed while it connects, or right after, destroys or refuses its streams.
    link.session.close()
  }
}

/** Whether a link has been quiet too long to be written to. */
function stale(link: Link): boolean {
  // The wall clock, which also counts the time a frozen process did not run.
  return link.open === 0 && Date.now() - link.quietSince >= IDLE_LIMIT_MS
}

/** The connection of one provider to one APNs origin. */
export class ApnsSession {
  readonly #authority: string
  readonly #connect: ApnsConnect
  readonly #timeoutMs: number
  readonly #owner: string
  #link: Link | undefined

  constructor(authority: string, open: ApnsConnect | undefined, timeoutMs: number, owner: string) {
    this.#authority = authority
    this.#connect = open ?? connectTo
    this.#timeoutMs = timeoutMs
    this.#owner = owner
  }

  /** Whether the session in use has had a request accepted. */
  get proven(): boolean {
    const link = this.#link
    return link?.proven === true && !link.session.closed && !stale(link)
  }

  /** Ends the session once the requests on it are done; the next request opens another. */
  close(): void {
    const link = this.#link
    this.#link = undefined
    if (link !== undefined) {
      retire(link)
    }
  }

  /**
   * Posts one request.
   *
   * @param headers - The request headers, pseudo-headers included.
   * @param body - The payload.
   * @returns The answer, or the classified loss. Never rejects.
   * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` on a changed realm.
   */
  post(headers: Record<string, string>, body: string): Promise<ApnsCall> {
    assertStandardRealmRoot(this.#owner)
    let link: Link
    let stream: ClientHttp2Stream
    try {
      link = this.#use()
      if (!link.answered && link.lead !== undefined) {
        return this.#after(link, link.lead, headers, body)
      }
      stream = link.session.request(headers)
    } catch {
      const neverConnected = this.#link?.connected !== true
      this.close()
      return newPromise((resolve) =>
        resolve({ kind: 'lost', failure: UNREACHABLE, neverConnected })
      )
    }
    const call = this.#exchange(link, stream, body)
    // Read only while the connection has had no answer.
    link.lead = call
    return call
  }

  /** Posts once the leading request of the connection has been answered; otherwise nothing was sent. */
  async #after(
    link: Link,
    lead: Promise<ApnsCall>,
    headers: Record<string, string>,
    body: string
  ): Promise<ApnsCall> {
    await checkedAwait(lead, this.#owner)
    if (link.answered) {
      return checkedAwait(this.post(headers, body), this.#owner)
    }
    return { kind: 'lost', failure: UNREACHABLE, neverConnected: !link.connected }
  }

  /** The session in use, or a new one when it can take no more requests. */
  #use(): Link {
    const held = this.#link
    // A `GOAWAY` leaves the session closed or destroyed as soon as it arrives.
    if (held !== undefined && !held.session.closed && !held.session.destroyed) {
      if (!stale(held)) {
        return held
      }
      retire(held)
    }
    this.#link = follow(this.#connect(this.#authority))
    return this.#link
  }

  /** Sends the body and waits for the answer, up to the bound. */
  #exchange(link: Link, stream: ClientHttp2Stream, body: string): Promise<ApnsCall> {
    link.open += 1
    return newPromise((resolve) => {
      const answer = collect(stream)
      let over = false
      const settle = (): void => {
        if (over) {
          return
        }
        over = true
        link.open -= 1
        link.quietSince = Date.now()
        link.lead = undefined
        resolve(ended(link, stream, answer))
        if (link.retired) {
          retire(link)
        }
      }
      const timer = setTimeout(() => {
        settle()
        stream.close(NGHTTP2_CANCEL)
        this.#abandon(link)
      }, this.#timeoutMs)
      stream.on('close', () => {
        clearTimeout(timer)
        settle()
      })
      stream.end(body)
    })
  }

  /** Stops using a session that let a request time out. */
  #abandon(link: Link): void {
    if (this.#link === link) {
      this.#link = undefined
    }
    if (link.connected) {
      retire(link)
    } else {
      link.session.destroy()
    }
  }
}
