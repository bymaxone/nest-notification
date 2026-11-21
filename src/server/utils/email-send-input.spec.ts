/**
 * @fileoverview Holds the lists and flags of a send to the kinds the send uses them as: a table of
 * every field with its accepted and refused values, and the bound on the length of a list.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'
import { MAX_LIST_ENTRIES } from './bounded-list'
import { readSendInput as readWithKeys } from './email-send-input'

const KEYS = [
  'tenantId',
  'to',
  'subject',
  'html',
  'text',
  'cc',
  'bcc',
  'tags',
  'attachments',
  'auditRedactValues',
  'publishProviderText'
]

/** What the reader hands back, typed loosely enough for the rows to look inside. */
interface Read extends Record<string, unknown> {
  attachments?: Array<{ content?: unknown }>
  tags?: unknown[]
  auditRedactValues?: unknown[]
}

function readSendInput(input: object): Read {
  return readWithKeys<Read>(input as Read, KEYS)
}

const base = { to: 'a@b.com', subject: 's', html: '<p>x</p>' }

function refusal(input: object): unknown {
  try {
    readSendInput(input)
  } catch (error) {
    return error
  }
  return undefined
}

describe('the send input reader', () => {
  it.each(['false', 'true', 0, 1, {}, null])('should refuse publishProviderText of %p', (value) => {
    const caught = refusal({ ...base, publishProviderText: value })

    expect(caught).toBeInstanceOf(NotificationException)
    expect(JSON.stringify((caught as NotificationException).getResponse())).toContain(
      'publishProviderText'
    )
  })

  it.each([true, false, undefined])('should accept publishProviderText of %p', (value) => {
    expect(refusal({ ...base, publishProviderText: value })).toBeUndefined()
  })

  it.each(['to', 'cc', 'bcc'])(
    'should refuse %s that is a number, an object or holds a number',
    (field) => {
      for (const value of [5, {}, [1], ['a@b.com', null]]) {
        expect(refusal({ ...base, [field]: value })).toBeInstanceOf(NotificationException)
      }
    }
  )

  it.each(['attachments', 'tags', 'auditRedactValues'])(
    'should refuse %s that is not a list',
    (field) => {
      for (const value of ['abc', {}, 5, null]) {
        expect(refusal({ ...base, [field]: value })).toBeInstanceOf(NotificationException)
      }
    }
  )

  it.each([5, null, {}, [], undefined, true])(
    'should refuse an attachment whose content is %p',
    (content) => {
      expect(refusal({ ...base, attachments: [{ filename: 'f', content }] })).toBeInstanceOf(
        NotificationException
      )
    }
  )

  it.each([5, null, 'x'])('should refuse an attachment that is %p, not an object', (entry) => {
    expect(refusal({ ...base, attachments: [entry] })).toBeInstanceOf(NotificationException)
  })

  it.each(['text', Buffer.from('x'), new Uint8Array([1])])(
    'should accept an attachment whose content is %p',
    (content) => {
      expect(refusal({ ...base, attachments: [{ filename: 'f', content }] })).toBeUndefined()
    }
  )

  it.each(['auditRedactValues', 'attachments', 'tags', 'to', 'cc', 'bcc'])(
    'should refuse %s of more than the bound before reading an entry',
    (field) => {
      let reads = 0
      const huge = new Proxy([] as unknown[], {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) {
            reads += 1
          }
          return property === 'length'
            ? MAX_LIST_ENTRIES + 1
            : Reflect.get(target, property, receiver)
        }
      })

      expect(refusal({ ...base, [field]: huge })).toBeInstanceOf(NotificationException)
      expect(reads).toBe(0)
    }
  )

  it('should accept a list of exactly the bound', () => {
    const values = Array.from({ length: MAX_LIST_ENTRIES }, () => 'v')

    expect(refusal({ ...base, auditRedactValues: values })).toBeUndefined()
  })

  it.each([-1, 1.5, Number.NaN, '3'])('should refuse a list whose length reads as %p', (length) => {
    const odd = new Proxy([] as unknown[], {
      get: (target, property, receiver) =>
        property === 'length' ? length : Reflect.get(target, property, receiver)
    })

    expect(refusal({ ...base, auditRedactValues: odd })).toBeInstanceOf(NotificationException)
  })

  it('should read each entry of a list once and return a copy', () => {
    let reads = 0
    const list = ['a'] as string[]
    const watched = new Proxy(list, {
      get(target, property, receiver) {
        if (property === '0') {
          reads += 1
        }
        return Reflect.get(target, property, receiver)
      }
    })

    const read = readSendInput({ ...base, auditRedactValues: watched })

    expect(reads).toBe(1)
    expect(read.auditRedactValues).toEqual(['a'])
    expect(read.auditRedactValues).not.toBe(watched)
  })

  it('should leave a field that is absent absent', () => {
    expect(Object.keys(readSendInput(base))).toEqual(['to', 'subject', 'html'])
  })

  it('should read the content of an attachment once, so the budget and the provider see one value', () => {
    let reads = 0
    const attachment: { filename: string; content?: string } = { filename: 'f' }
    Object.defineProperty(attachment, 'content', {
      enumerable: true,
      get() {
        reads += 1
        return reads === 1 ? 'small' : 'x'.repeat(10_000)
      }
    })

    const read = readSendInput({ ...base, attachments: [attachment] })

    expect(reads).toBe(1)
    expect(read.attachments?.[0]?.content).toBe('small')
    expect(read.attachments?.[0]).not.toBe(attachment)
  })

  it('should read each field of a tag once and hand on a copy', () => {
    let reads = 0
    const tag = { name: 'n' }
    Object.defineProperty(tag, 'value', {
      enumerable: true,
      get() {
        reads += 1
        return `v${String(reads)}`
      }
    })

    const read = readSendInput({ ...base, tags: [tag] })

    expect(reads).toBe(1)
    expect(read.tags?.[0]).toEqual({ name: 'n', value: 'v1' })
  })

  it.each([
    [5, 'not_a_list_of_strings'],
    [['a@b.com', 7], 'not_a_list_of_strings'],
    [Array.from({ length: MAX_LIST_ENTRIES + 1 }, () => 'a@b.com'), 'too_many_recipients']
  ])('should give the recipient refusal the reason it has', (value, reason) => {
    const caught = refusal({ ...base, cc: value }) as NotificationException

    expect(caught.getResponse()).toMatchObject({ error: { details: { reason, field: 'cc' } } })
  })

  // A send built from a class: its fields are prototype getters or non-enumerable, and none of them may be lost.
  it('should keep fields that are inherited, getters or not enumerable', () => {
    class FromClass {
      get publishProviderText(): boolean {
        return false
      }
      get auditRedactValues(): string[] {
        return ['secret']
      }
    }
    const input = Object.assign(new FromClass(), base)
    Object.defineProperty(input, 'text', { value: 'plain', enumerable: false })

    const read = readSendInput(input)

    expect(read.publishProviderText).toBe(false)
    expect(read.auditRedactValues).toEqual(['secret'])
    expect(read.text).toBe('plain')
  })

  it('should keep the fields of an attachment and a tag that are inherited getters', () => {
    class Attachment {
      get filename(): string {
        return 'f.txt'
      }
      get content(): string {
        return 'body'
      }
    }
    class Tag {
      get name(): string {
        return 'n'
      }
      get value(): string {
        return 'v'
      }
    }

    const read = readSendInput({ ...base, attachments: [new Attachment()], tags: [new Tag()] })

    expect(read.attachments).toEqual([{ filename: 'f.txt', content: 'body' }])
    expect(read.tags).toEqual([{ name: 'n', value: 'v' }])
  })

  it.each(['cid', 'encoding', 'headers', 'path'])(
    'should refuse an attachment that carries the field %s the library does not',
    (key) => {
      const caught = refusal({
        ...base,
        attachments: [{ filename: 'f', content: 'x', [key]: 'v' }]
      })

      expect(caught).toBeInstanceOf(NotificationException)
    }
  )

  it.each([5, {}, null])(
    'should refuse an attachment whose filename or contentType is %p',
    (value) => {
      for (const field of ['filename', 'contentType']) {
        expect(
          refusal({ ...base, attachments: [{ filename: 'f', content: 'x', [field]: value }] })
        ).toBeInstanceOf(NotificationException)
      }
    }
  )

  it('should keep the filename, content and contentType of an attachment', () => {
    const read = readSendInput({
      ...base,
      attachments: [{ filename: 'f.txt', content: 'x', contentType: 'text/plain' }]
    })

    expect(read.attachments).toEqual([
      { filename: 'f.txt', content: 'x', contentType: 'text/plain' }
    ])
  })
})
