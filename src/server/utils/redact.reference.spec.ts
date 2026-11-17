/**
 * @fileoverview Holds `collectEchoedExcerpts` to a missing reference: a send with no html part has
 * no body to echo against, and the call must neither throw nor give up on a field too long to scan.
 * @layer utils
 */

import { MAX_ECHO_SCAN_LENGTH, collectEchoedExcerpts } from './redact'

describe('collectEchoedExcerpts without a reference', () => {
  it('should find nothing to echo against', () => {
    expect(collectEchoedExcerpts('connect ECONNREFUSED 127.0.0.1:1099', undefined)).toEqual([])
  })

  // A field that does not fit in the scan is returned whole, with a body or without one.
  it('should still return a field too long to scan whole', () => {
    const huge = 'x'.repeat(MAX_ECHO_SCAN_LENGTH + 1)

    expect(collectEchoedExcerpts(huge, undefined)).toEqual([huge])
  })

  it('should still collect an echo when there is a reference', () => {
    const body = '<p>Hello Jane, Your password reset code is 998877. It expires shortly.</p>'

    expect(
      collectEchoedExcerpts('rejected: Hello Jane, Your password reset code is 998877', body)
    ).not.toEqual([])
  })
})
