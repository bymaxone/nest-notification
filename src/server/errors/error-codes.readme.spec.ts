/**
 * @fileoverview Holds the README's "Raised by" table to the catalog and to the source: every
 * code appears with its HTTP status, and a code is marked reserved exactly when no source file
 * constructs a `NotificationException` with it. A throw site added for a reserved code, or
 * removed for a documented one, fails here instead of leaving the README wrong.
 * @layer domain
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { readmeTable, unquote } from '../config/__tests__/readme-tables'

import { NOTIFICATION_ERROR_DEFINITIONS } from './notification-error-codes'

const SRC = join(__dirname, '..', '..')

/** Every non-test source file under `src/`, as absolute paths. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry) ? [path] : []
  })
}

/** The catalog keys some source file constructs a `NotificationException` with. */
function thrownKeys(): Set<string> {
  const pattern = /new NotificationException\(\s*'([A-Z_]+)'/g
  const keys = new Set<string>()
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      keys.add(match[1] ?? '')
    }
  }
  return keys
}

const rows = readmeTable(['Code', 'Status', 'Raised by']).map(
  ([code = '', status = '', by = '']) => ({
    code: unquote(code),
    status: Number(status),
    by
  })
)
const thrown = thrownKeys()

describe('README error table', () => {
  // A table that parses to nothing would let every case below pass vacuously.
  it('should list every code of the catalog and nothing else', () => {
    expect(rows.map((row) => row.code).sort()).toEqual(
      Object.values(NOTIFICATION_ERROR_DEFINITIONS)
        .map((definition) => definition.code as string)
        .sort()
    )
    expect(thrown.size).toBeGreaterThan(8)
  })

  it.each(Object.entries(NOTIFICATION_ERROR_DEFINITIONS))(
    'should document %s with its status and its raiser',
    (key, definition) => {
      const row = rows.find((candidate) => candidate.code === definition.code)

      expect(row?.status).toBe(definition.status)
      expect(row?.by.startsWith('reserved')).toBe(!thrown.has(key))
    }
  )
})
