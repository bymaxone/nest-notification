/**
 * @fileoverview No source or spec file may carry a bidirectional control as a raw character.
 * @layer test
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Written as escapes on purpose: this file must not hold the characters it looks for.
const BIDIRECTIONAL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : []
  )
}

describe('source hygiene', () => {
  it('should hold no bidirectional control as a raw character in any file under src', () => {
    const offenders = sourceFiles(join(__dirname, '..', '..')).filter((file) =>
      BIDIRECTIONAL.test(readFileSync(file, 'utf8'))
    )

    expect(offenders).toEqual([])
  })

  it('should find the files it scans', () => {
    expect(sourceFiles(join(__dirname, '..', '..')).length).toBeGreaterThan(50)
  })
})
