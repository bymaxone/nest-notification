/**
 * @fileoverview Holds the availability classifier to the failures a backing service actually
 * produces: the messages are those a real ioredis 6.0.0 client printed (refused and DNS failures
 * with the default retry limit, a command timeout against a server that never answered, a closed
 * connection, the offline queue switched off) and the replies a Redis server sent, captured
 * verbatim, plus the error codes Node and nodemailer set. Anything else is not availability.
 * @layer utils
 */

import { errorCodeOf, isUnavailableError } from './availability'

class ReplyError extends Error {
  override name = 'ReplyError'
}
class MaxRetriesPerRequestError extends Error {
  override name = 'MaxRetriesPerRequestError'
}

const coded = (code: string, message = 'boom'): Error => Object.assign(new Error(message), { code })

describe('isUnavailableError', () => {
  // Captured from ioredis 6.0.0 against a closed port, a hung server and a closed client.
  it.each([
    [
      'Reached the max retries per request limit (which is 1). Refer to "maxRetriesPerRequest" option for details.'
    ],
    ["Stream isn't writeable and enableOfflineQueue options is false"],
    ['Command timed out'],
    ['Connection is closed.']
  ])('should treat the ioredis failure %j as unavailable', (message) => {
    expect(isUnavailableError(new Error(message))).toBe(true)
  })

  it('should treat a MaxRetriesPerRequestError as unavailable whatever its text', () => {
    expect(isUnavailableError(new MaxRetriesPerRequestError('anything'))).toBe(true)
  })

  // Captured from a Redis server answering a command with an error reply.
  it.each([
    "READONLY You can't write against a read only replica.",
    'LOADING Redis is loading the dataset in memory',
    'CLUSTERDOWN The cluster is down',
    "MASTERDOWN Link with MASTER is down and replica-serve-stale-data is set to 'no'.",
    // A transient reply: the server asks the client to try the same command again later.
    'TRYAGAIN Multiple keys request during rehashing of slot'
  ])('should treat the Redis reply %j as unavailable', (message) => {
    expect(isUnavailableError(new ReplyError(message))).toBe(true)
  })

  // Replies that name a fault of the caller or of the deployment, not an outage.
  it.each([
    'ERR wrong number of arguments',
    'NOAUTH Authentication required.',
    "OOM command not allowed when used memory > 'maxmemory'.",
    'MISCONF Redis is configured to save RDB snapshots'
  ])('should not treat the Redis reply %j as unavailable', (message) => {
    expect(isUnavailableError(new ReplyError(message))).toBe(false)
  })

  // The reply names are matched as the first word of the message: a defect whose text only mentions
  // one of them, or a longer word that begins with it, is a defect and stays a 500.
  it.each([
    'the TRYAGAIN reply was mishandled',
    'ERR unknown command TRYAGAIN',
    'TRYAGAINLATER please',
    'MASTERDOWNGRADE is not supported',
    'try again later'
  ])('should not treat the text %j as a Redis outage', (message) => {
    expect(isUnavailableError(new ReplyError(message))).toBe(false)
    expect(isUnavailableError(new Error(message))).toBe(false)
  })

  it.each([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNABORTED',
    'ESOCKETTIMEDOUT',
    'ECONNECTION',
    'ESOCKET',
    'EDNS'
  ])('should treat the error code %s as unavailable', (code) => {
    expect(isUnavailableError(coded(code))).toBe(true)
  })

  it.each(['EAUTH', 'EENVELOPE', 'EMESSAGE', 'ERR_INVALID_ARG_TYPE', 'EACCES', 'ENOENT'])(
    'should not treat the error code %s as unavailable',
    (code) => {
      expect(isUnavailableError(coded(code))).toBe(false)
    }
  )

  // The texts are matched whole: the same words inside a longer message are not an outage.
  it.each([
    'Connection is closed.',
    'Command timed out',
    "Stream isn't writeable and enableOfflineQueue options is false",
    'Reached the max retries per request limit (which is 20). Refer to "maxRetriesPerRequest" option for details.'
  ])('should not match %j when it is part of a longer message', (phrase) => {
    expect(isUnavailableError(new Error(`while reading the key: ${phrase}`))).toBe(false)
    expect(isUnavailableError(new Error(`${phrase} while reading the key`))).toBe(
      phrase.startsWith('Reached')
    )
  })

  it('should match the retry limit whatever the limit is', () => {
    expect(
      isUnavailableError(new Error('Reached the max retries per request limit (which is 20).'))
    ).toBe(true)
  })

  it('should not match a Redis reply word inside a longer message', () => {
    expect(isUnavailableError(new Error('the READONLY flag is documented'))).toBe(false)
  })

  it('should look down the cause chain', () => {
    const error = new Error('SMTP send failed', { cause: coded('ECONNREFUSED') })

    expect(isUnavailableError(error)).toBe(true)
  })

  it('should stop at a loop in the chain', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    ;(first as { cause?: unknown }).cause = second

    expect(isUnavailableError(first)).toBe(false)
  })

  // A chain that makes its next link only when `cause` is read, and counts the reads.
  it('should read only a bounded part of a chain that never ends', () => {
    let reads = 0
    const link = (): Error => {
      const error = new Error('wrapper')
      Object.defineProperty(error, 'cause', {
        get: () => {
          reads += 1
          return link()
        }
      })
      return error
    }

    expect(isUnavailableError(link())).toBe(false)
    expect(reads).toBeLessThanOrEqual(8)
  })

  it('should find an unavailability inside the window and not beyond it', () => {
    const chain = (depth: number): Error => {
      let error: Error = coded('ECONNREFUSED')
      for (let link = 0; link < depth; link += 1) {
        error = new Error('wrapper', { cause: error })
      }
      return error
    }

    expect(isUnavailableError(chain(7))).toBe(true)
    expect(isUnavailableError(chain(8))).toBe(false)
  })

  it.each([
    ['a TypeError', new TypeError("Cannot read properties of undefined (reading 'get')")],
    ['a plain Error', new Error('Invalid login: 535 5.7.8 authentication failed')],
    ['a string', 'ECONNREFUSED'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7]
  ])('should not treat %s as unavailable', (_name, value) => {
    expect(isUnavailableError(value)).toBe(false)
  })

  // The text is matched whole, not as a substring: a defect that merely mentions a phrase is a defect.
  it('should not match an ioredis phrase inside a longer message', () => {
    expect(isUnavailableError(new Error('the Connection is closed. flag was never read'))).toBe(
      false
    )
  })

  it('should survive a hostile getter', () => {
    const hostile = {
      get code(): string {
        throw new Error('nope')
      },
      get message(): string {
        throw new Error('nope')
      }
    }

    expect(isUnavailableError(hostile)).toBe(false)
  })

  it('should read the error code of a plain object, as SDKs reject with one', () => {
    expect(isUnavailableError({ code: 'ETIMEDOUT', message: 'x' })).toBe(true)
  })
})

describe('errorCodeOf', () => {
  it('should answer the code of the error, or of the first cause that has one', () => {
    expect(errorCodeOf(coded('ECONNREFUSED'))).toBe('ECONNREFUSED')
    expect(errorCodeOf(new Error('wrapper', { cause: coded('ETIMEDOUT') }))).toBe('ETIMEDOUT')
  })

  it.each([
    ['a code with spaces and an address', coded('user jane@acme.com')],
    ['a lower-case code', coded('econnrefused')],
    ['a code of 40 characters', coded('E'.repeat(40))],
    ['a numeric code', Object.assign(new Error('x'), { code: 500 })],
    ['no code', new Error('x')],
    ['null', null]
  ])('should answer nothing for %s', (_name, value) => {
    expect(errorCodeOf(value)).toBeUndefined()
  })

  // The first code names another fault, the second is an outage: the outage is what is carried.
  it('should prefer an availability code deeper in the chain over an earlier code', () => {
    const error = Object.assign(new Error('auth'), {
      code: 'EAUTH',
      cause: coded('ECONNREFUSED')
    })

    expect(errorCodeOf(error)).toBe('ECONNREFUSED')
  })

  it('should carry the first code when none of them is an outage', () => {
    const error = Object.assign(new Error('auth'), { code: 'EAUTH', cause: coded('EENVELOPE') })

    expect(errorCodeOf(error)).toBe('EAUTH')
  })

  it('should stop at a loop in the chain', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    ;(first as { cause?: unknown }).cause = second

    expect(errorCodeOf(first)).toBeUndefined()
  })
})

/** An error whose `cause` points back at itself, counting every read of the link. */
function loopingError(onRead: () => void): Error {
  const first = new Error('first')
  const second = new Error('second')
  for (const [from, to] of [
    [first, second],
    [second, first]
  ] as const) {
    Object.defineProperty(from, 'cause', {
      get: () => {
        onRead()
        return to
      }
    })
  }
  return first
}

describe('a chain that loops', () => {
  it('should be read once round, not until the window is spent', () => {
    let reads = 0

    expect(isUnavailableError(loopingError(() => (reads += 1)))).toBe(false)

    expect(reads).toBeLessThanOrEqual(2)
  })

  it('should be read once round when looking for a code as well', () => {
    let reads = 0

    expect(errorCodeOf(loopingError(() => (reads += 1)))).toBeUndefined()

    expect(reads).toBeLessThanOrEqual(2)
  })

  it('should read exactly the window of a code chain, no more and no fewer', () => {
    const chain = (depth: number): Error => {
      let error: Error = coded('ETIMEDOUT')
      for (let link = 0; link < depth; link += 1) {
        error = new Error('wrapper', { cause: error })
      }
      return error
    }

    expect(errorCodeOf(chain(7))).toBe('ETIMEDOUT')
    expect(errorCodeOf(chain(8))).toBeUndefined()
  })
})
