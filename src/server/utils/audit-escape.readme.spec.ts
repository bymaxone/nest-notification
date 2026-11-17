/**
 * @fileoverview Holds the README's statement of how deep the audit metadata is kept to
 * `MAX_METADATA_DEPTH`, so the number a consumer reads moves with the constant.
 * @layer infrastructure
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_METADATA_DEPTH } from './audit-escape'

const README = readFileSync(join(__dirname, '..', '..', '..', 'README.md'), 'utf8')

describe('README on the depth of the audit metadata', () => {
  // The entry is level 0 and `metadata` itself is level 1, so the levels of nesting below it that
  // are kept are the constant less one.
  it('should state the levels of nesting below metadata that are kept', () => {
    const kept = MAX_METADATA_DEPTH - 1

    expect(README).toContain(
      `Metadata is kept down to ${String(kept)} levels of nesting below the \`metadata\` object`
    )
  })

  it('should name the marker a deeper value arrives as', () => {
    expect(README).toMatch(/nesting below the `metadata` object[^.]*`\[depth limit\]`/)
  })
})
