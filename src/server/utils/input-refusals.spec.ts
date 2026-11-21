/**
 * @fileoverview Holds every refusal of an input of the wrong kind to saying which boundary, which
 * parameter and why, in the message and in the details: a table with one row per refusal.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'
import { assertFunction } from '../config/option-numbers'
import { boundedList } from './bounded-list'
import { readSendInput } from './email-send-input'
import { assertDeliverVia, assertOtpAction } from './otp-input'

const isString = (entry: unknown): entry is string => typeof entry === 'string'
const base = { to: 'a@b.com', subject: 's', html: '<p>x</p>' }
const KEYS = [
  'to',
  'subject',
  'html',
  'cc',
  'tags',
  'attachments',
  'auditRedactValues',
  'publishProviderText'
]

function refusalOf(run: () => unknown): { message: unknown; details: unknown } {
  try {
    run()
  } catch (error) {
    const body = (error as NotificationException).getResponse() as {
      error: { message: unknown; details: unknown }
    }
    return body.error
  }
  throw new Error('expected a refusal')
}

const readSend = (input: object): unknown =>
  readSendInput<Record<string, unknown>>({ ...base, ...input }, KEYS)

describe('the message and the details of each refusal', () => {
  it.each([
    [
      'a value that is not a list',
      () => boundedList('Owner', 'things', 'abc', isString),
      '[Owner] things expected a list',
      'expected a list'
    ],
    [
      'a list over the bound',
      () => boundedList('Owner', 'things', new Array<string>(1001).fill('a'), isString),
      '[Owner] things expected at most 1000 entries',
      'expected at most 1000 entries'
    ],
    [
      'an entry of another kind',
      () => boundedList('Owner', 'things', ['a', 5], isString),
      '[Owner] things entry 1 is of an unexpected kind',
      'entry 1 is of an unexpected kind'
    ],
    [
      'a publishProviderText that is not a boolean',
      () => readSend({ publishProviderText: 'false' }),
      '[EmailService] publishProviderText expected a boolean',
      'expected a boolean'
    ],
    [
      'auditRedactValues that is not a list',
      () => readSend({ auditRedactValues: 'x' }),
      '[EmailService] auditRedactValues expected a list',
      'expected a list'
    ],
    [
      'tags that are not a list',
      () => readSend({ tags: 'x' }),
      '[EmailService] tags expected a list',
      'expected a list'
    ],
    [
      'attachments that are not a list',
      () => readSend({ attachments: 'x' }),
      '[EmailService] attachments expected a list',
      'expected a list'
    ],
    [
      'an attachment with no readable content',
      () => readSend({ attachments: [{ filename: 'f', content: 5 }] }),
      '[EmailService] attachments an attachment has no readable content',
      'an attachment has no readable content'
    ],
    [
      'an unknown action',
      () => assertOtpAction('Owner', 'verfy'),
      '[Owner] action expected generate, verify or consume',
      'expected generate, verify or consume'
    ],
    [
      'an unknown delivery',
      () => assertDeliverVia('Owner', 'sms'),
      '[Owner] deliverVia expected email or manual',
      'expected email or manual'
    ]
  ] as const)('should say what was refused for %s', (_label, run, message, reason) => {
    const refusal = refusalOf(run)

    expect(refusal.message).toBe(message)
    expect(refusal.details).toMatchObject({ reason })
  })
})

describe('what a list accepts', () => {
  it('should accept an empty list', () => {
    expect(boundedList('Owner', 'things', [], isString)).toEqual([])
  })

  it('should accept an array constructed with length zero', () => {
    expect(boundedList('Owner', 'things', new Array<string>(0), isString)).toEqual([])
  })
})

describe('assertFunction', () => {
  it('should accept a function and an absent value, and refuse the rest by kind', () => {
    expect(() => assertFunction('audit.maskRecipient', () => 'x')).not.toThrow()
    expect(() => assertFunction('audit.maskRecipient', undefined)).not.toThrow()
    expect(() => assertFunction('audit.maskRecipient', 'x')).toThrow('must be a function')
  })
})
