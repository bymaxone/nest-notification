/**
 * @fileoverview Holds the list of send fields the reader copies to every field of `EmailSendInput`:
 * the file fails to compile when the type gains a field the list misses.
 * @layer domain
 */

import type { UnlistedSendKey } from './email.service'

describe('the fields of a send the reader copies', () => {
  it('should leave no field of EmailSendInput unlisted', () => {
    const unlisted: UnlistedSendKey[] = []

    expect(unlisted).toEqual([])
  })
})
