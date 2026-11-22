/**
 * @fileoverview Holds the copy of a send request to what the caller gave: a field it left out is not
 * a key of the copy, and the lists it gave are copied entry by entry.
 * @layer utils
 */

import { readSendOptions } from './provider-send-options'

const BASE = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' } as const

describe('readSendOptions', () => {
  it('should give no attachments or tags key when the caller gave none', () => {
    const copy = readSendOptions({ ...BASE })

    expect(Object.keys(copy)).not.toContain('attachments')
    expect(Object.keys(copy)).not.toContain('tags')
  })

  it('should copy each entry of the lists the caller gave', () => {
    const attachment = { filename: 'a.txt', content: 'eA==' }
    const tag = { name: 'n', value: 'v' }

    const copy = readSendOptions({ ...BASE, attachments: [attachment], tags: [tag] })

    expect(copy.attachments).toEqual([attachment])
    expect(copy.attachments?.[0]).not.toBe(attachment)
    expect(copy.tags).toEqual([tag])
  })

  it('should read a null list as none', () => {
    const copy = readSendOptions({ ...BASE, attachments: null, tags: null } as never)

    expect(copy.attachments).toBeUndefined()
    expect(copy.tags).toBeUndefined()
  })
})
