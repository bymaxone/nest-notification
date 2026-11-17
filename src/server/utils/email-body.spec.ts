/**
 * @fileoverview Holds the body-part guard to the types nodemailer and the Resend SDK accept but the
 * echo scrub cannot read: a Buffer, a typed array, an array, a number or an object (which
 * nodemailer reads as a content descriptor, a file path included) is refused, a string or an
 * absent part is not.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

import { assertBodyParts } from './email-body'

function refusal(html: unknown, text: unknown): NotificationException {
  try {
    assertBodyParts(html, text)
  } catch (error) {
    return error as NotificationException
  }
  throw new Error('expected a refusal')
}

describe('assertBodyParts', () => {
  it.each([
    ['both strings', '<p>x</p>', 'x'],
    ['empty strings', '', ''],
    ['no html', undefined, 'x'],
    ['no text', '<p>x</p>', undefined],
    ['neither', undefined, undefined],
    ['null parts', null, null]
  ])('should accept %s', (_name, html, text) => {
    expect(() => assertBodyParts(html, text)).not.toThrow()
  })

  // Every one of these is a value the transport would still send, with content the scrub could
  // not have compared against an error text.
  it.each([
    ['a Buffer', Buffer.from('x')],
    ['a Uint8Array', new Uint8Array(2)],
    ['an ArrayBuffer', new ArrayBuffer(2)],
    ['an array', []],
    ['a number', 42],
    ['true', true],
    ['an object', { a: 1 }],
    ['a content descriptor', { path: '/etc/hostname' }]
  ])('should refuse %s as the html part', (_name, value) => {
    const error = refusal(value, 'x')

    expect(error).toBeInstanceOf(NotificationException)
    expect(error.code).toBe('notification.email_missing_body')
    expect(error.getStatus()).toBe(400)
    expect(error.getResponse()).toMatchObject({
      error: { details: { part: 'html', reason: 'not_a_string' } }
    })
  })

  it.each([
    ['a Buffer', Buffer.from('x')],
    ['a Uint8Array', new Uint8Array(2)],
    ['an array', []],
    ['a number', 42],
    ['an object', { content: 'x' }]
  ])('should refuse %s as the text part', (_name, value) => {
    const error = refusal('<p>x</p>', value)

    expect(error.code).toBe('notification.email_missing_body')
    expect(error.getResponse()).toMatchObject({
      error: { details: { part: 'text', reason: 'not_a_string' } }
    })
  })

  it('should name the html part when both are wrong', () => {
    expect(refusal(42, 42).getResponse()).toMatchObject({ error: { details: { part: 'html' } } })
  })

  // The message is the host's only explanation, so it is pinned, and it says nothing of the value.
  it('should explain the refusal in its own words', () => {
    expect(refusal(Buffer.from('x'), 'x').getResponse()).toMatchObject({
      error: { message: 'The html and text parts of an email must be strings' }
    })
  })

  // The message must not echo the value: it may be a secret, or a path.
  it('should not put the value into the body', () => {
    const body = JSON.stringify(refusal({ path: '/etc/hostname' }, 'x').getResponse())

    expect(body).not.toContain('/etc/hostname')
  })
})
