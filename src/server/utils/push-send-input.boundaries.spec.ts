/**
 * @fileoverview Pins the exact limits of the push input reader: the length bounds, the control
 * characters, the `data` key count and the integer fields.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

import {
  MAX_PUSH_DATA_KEYS,
  MAX_PUSH_TEXT,
  MAX_PUSH_TOKEN_LENGTH,
  isUsableToken,
  readIdList,
  readPush
} from './push-send-input'

const base = { tokens: ['t'], title: 'x', body: 'y' }
const refused = (extra: Record<string, unknown>): void => {
  expect(() => readPush('T', { ...base, ...extra } as never)).toThrow(NotificationException)
}
const accepted = (extra: Record<string, unknown>): void => {
  expect(() => readPush('T', { ...base, ...extra } as never)).not.toThrow()
}

describe('isUsableToken', () => {
  it('should accept an entry of 1 and of the longest length', () => {
    expect(isUsableToken('a')).toBe(true)
    expect(isUsableToken('a'.repeat(MAX_PUSH_TOKEN_LENGTH))).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['one past the longest', 'a'.repeat(MAX_PUSH_TOKEN_LENGTH + 1)],
    ['a null character at the start', '\u0000a'],
    ['a control character at the start', '\u0001a'],
    ['the last C0 control', 'a\u001f'],
    ['DEL', 'a\u007f']
  ])('should refuse %s', (_label, entry) => {
    expect(isUsableToken(entry)).toBe(false)
  })

  it('should accept a space, the first printable character, and the one after DEL', () => {
    expect(isUsableToken('a b')).toBe(true)
    expect(isUsableToken(' ')).toBe(true)
    expect(isUsableToken('\u0080')).toBe(true)
  })
})

describe('readIdList', () => {
  it('should refuse a list when only one entry is unusable', () => {
    expect(() => readIdList('T', 'ids', ['ok', ''])).toThrow(NotificationException)
    expect(() => readIdList('T', 'ids', ['', 'ok'])).toThrow(NotificationException)
  })
})

describe('readPush limits', () => {
  it('should take text of exactly the longest length and refuse one more', () => {
    accepted({ title: 'a'.repeat(MAX_PUSH_TEXT) })
    refused({ title: 'a'.repeat(MAX_PUSH_TEXT + 1) })
    accepted({ subtitle: 'a'.repeat(MAX_PUSH_TEXT) })
    refused({ subtitle: 'a'.repeat(MAX_PUSH_TEXT + 1) })
  })

  it('should take exactly the most data keys and refuse one more', () => {
    const keys = (count: number): Record<string, string> =>
      Object.fromEntries(Array.from({ length: count }, (_v, index) => [`k${String(index)}`, 'v']))
    accepted({ data: keys(MAX_PUSH_DATA_KEYS) })
    refused({ data: keys(MAX_PUSH_DATA_KEYS + 1) })
  })

  it('should take a data key and value of exactly the longest length and refuse one more', () => {
    accepted({ data: { ['k'.repeat(MAX_PUSH_TOKEN_LENGTH)]: 'v' } })
    refused({ data: { ['k'.repeat(MAX_PUSH_TOKEN_LENGTH + 1)]: 'v' } })
    accepted({ data: { k: 'v'.repeat(MAX_PUSH_TEXT) } })
    refused({ data: { k: 'v'.repeat(MAX_PUSH_TEXT + 1) } })
  })

  it.each([[[]], ['text'], [7], [null]])('should refuse data of %j', (data) => {
    refused({ data })
  })

  it('should refuse a data object that is not plain', () => {
    refused({ data: new Date() })
  })

  it.each([['badge'], ['ttlSeconds']])('should take 0 and refuse a bad %s', (field) => {
    accepted({ [field]: 0 })
    accepted({ [field]: 3 })
    refused({ [field]: -1 })
    refused({ [field]: 1.5 })
    refused({ [field]: '3' })
    refused({ [field]: Number.NaN })
  })

  it.each([['mutableContent'], ['contentAvailable']])(
    'should refuse a %s that is not a boolean',
    (field) => {
      accepted({ [field]: false })
      refused({ [field]: 'true' })
      refused({ [field]: 1 })
    }
  )

  it('should refuse a priority that is not high or normal', () => {
    accepted({ priority: 'high' })
    accepted({ priority: 'normal' })
    refused({ priority: 'low' })
  })
})
