/**
 * @fileoverview Pins what each refusal of the push input reader says: the owner, the parameter and
 * the reason, as a host sees them in `error.details`.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

import { readIdList, readPush, readTokenList } from './push-send-input'

const OWNER = 'Owner'
const base = { tokens: ['t'], title: 'x', body: 'y' }

/** What a caller of the library sees of a refusal. */
function detailsOf(run: () => unknown): { code: unknown; details: unknown } {
  try {
    run()
  } catch (thrown) {
    const exception = thrown as NotificationException
    const error = (exception.getResponse() as { error: { code: unknown; details: unknown } }).error
    return { code: error.code, details: error.details }
  }
  throw new Error('expected a refusal')
}

const text = 'must be a string of at most 4096 characters'
const object = (extra: Record<string, unknown>): unknown =>
  readPush(OWNER, { ...base, ...extra } as never)

describe('the refusals of the push input reader', () => {
  it.each([
    ['tokens that are an empty list', { tokens: [] }, 'tokens', 'needs at least one entry'],
    ['a title that is not text', { title: 7 }, 'title', text],
    ['a body that is not text', { body: 7 }, 'body', text],
    ['a subtitle that is too long', { subtitle: 'a'.repeat(4097) }, 'subtitle', text],
    ['data that is a list', { data: [] }, 'data', 'must be an object of strings'],
    ['data that is a Date', { data: new Date() }, 'data', 'must be a plain object'],
    [
      'data with a value that is not text',
      { data: { k: 1 } },
      'data',
      'holds a key or a value that is not a bounded string'
    ],
    ['a badge that is negative', { badge: -1 }, 'badge', 'must be a non-negative integer'],
    [
      'a ttlSeconds that is not an integer',
      { ttlSeconds: 1.5 },
      'ttlSeconds',
      'must be a non-negative integer'
    ],
    [
      'a mutableContent that is not a boolean',
      { mutableContent: 'y' },
      'mutableContent',
      'must be a boolean'
    ],
    [
      'a contentAvailable that is not a boolean',
      { contentAvailable: 1 },
      'contentAvailable',
      'must be a boolean'
    ],
    ['a priority that is not named', { priority: 'low' }, 'priority', "must be 'high' or 'normal'"]
  ])(
    'should name the owner, the parameter and the reason for %s',
    (_label, extra, parameter, reason) => {
      expect(detailsOf(() => object(extra))).toStrictEqual({
        code: 'notification.invalid_scope_identifier',
        details: { boundary: OWNER, parameter, reason }
      })
    }
  )

  it('should name more than the data key limit', () => {
    const keys = Object.fromEntries(
      Array.from({ length: 65 }, (_v, index) => [`k${String(index)}`, 'v'])
    )

    expect(detailsOf(() => object({ data: keys })).details).toStrictEqual({
      boundary: OWNER,
      parameter: 'data',
      reason: 'has more than 64 keys'
    })
  })

  it.each([null, undefined, 'x', 7])(
    'should refuse a push of %j as the options it is',
    (options) => {
      expect(detailsOf(() => readPush(OWNER, options as never))).toStrictEqual({
        code: 'notification.invalid_scope_identifier',
        details: { boundary: OWNER, parameter: 'options', reason: 'must be an object' }
      })
    }
  )

  it('should say which ticket list holds an unusable entry', () => {
    expect(detailsOf(() => readIdList(OWNER, 'ids', ['ok', ''])).details).toStrictEqual({
      boundary: OWNER,
      parameter: 'ids',
      reason: 'holds an entry that is not a bounded, printable string'
    })
  })

  it.each([[['a', 7]], [[null]], [[{}]]])(
    'should refuse a token list of %j for its entry',
    (list) => {
      expect(detailsOf(() => readTokenList(OWNER, 'tokens', list)).details).toMatchObject({
        boundary: OWNER,
        parameter: 'tokens'
      })
    }
  )
})
