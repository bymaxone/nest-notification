/**
 * @fileoverview Holds the recipients and bodies handed to Nodemailer as objects with their own keys
 * to one rule: the message Nodemailer builds from them is the message it builds from the strings.
 * @layer infrastructure
 */

import MailComposer from 'nodemailer/lib/mail-composer'

import { ownBody, ownRecipients } from './smtp-message-parts'

const BODIES = ['', ' ', 'x', '\n', '<p>é</p>', 'a'.repeat(5000)]
const LISTS: (string | string[] | undefined)[] = [
  undefined,
  '',
  [],
  [''],
  'a@b.c',
  ['a@b.c', 'Bob <b@x.com>'],
  ['a@b.c', 'c@d.e']
]

/** The message as text, with the random boundaries made equal so two builds can be compared. */
function build(options: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    new MailComposer({
      from: 'a@b.c',
      subject: 's',
      date: new Date(0),
      messageId: '<m@x>',
      ...options
    })
      .compile()
      .build((error, message) => {
        resolve(
          error
            ? `ERROR ${error.message}`
            : message
                .toString()
                .replace(/_?-{2,}[-=\w]{10,}/gu, 'B')
                .replace(/boundary="?[^";\r\n]+"?/gu, 'boundary=B')
        )
      })
  })
}

describe('the recipients and bodies handed to Nodemailer', () => {
  describe.each(BODIES)('a text body of %j', (text) => {
    it.each([undefined, ...BODIES])(
      'should build the message the strings build, with an html body of %j',
      async (html) => {
        const raw = await build({ to: 'd@e.f', text, html })

        const own = await build({
          to: 'd@e.f',
          text: ownBody(text),
          html: html === undefined ? undefined : ownBody(html)
        })

        expect(own).toBe(raw)
      }
    )
  })

  describe.each(['to', 'cc', 'bcc', 'replyTo'])('a %s header', (header) => {
    it.each(LISTS)('should build the message the strings build, for %j', async (value) => {
      const others = header === 'to' ? {} : { to: 'd@e.f' }
      const raw = await build({ ...others, [header]: value, text: 'x' })

      const own = await build({ ...others, [header]: ownRecipients(value), text: 'x' })

      expect(own).toBe(raw)
    })
  })
})
