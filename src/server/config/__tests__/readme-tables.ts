/**
 * @fileoverview Reads the README tables whose cells state option defaults, so a spec can hold the
 * prose to the code. Lives under `__tests__/`, which the coverage and mutation configs exclude.
 * @layer infrastructure
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The README ships to npm, and a table that drifted from the defaults is read by a consumer as the
// contract; nothing else in the pipeline reads these cells.

const README = readFileSync(join(__dirname, '..', '..', '..', '..', 'README.md'), 'utf8')

/** The README with fenced blocks removed, so a `|` inside a code sample is never a table row. */
const PROSE = README.replace(/^```[\s\S]*?^```$/gm, '')

/** Splits one table row into its trimmed cells, honouring the `\|` escape inside a cell. */
function cellsOf(row: string): string[] {
  return row
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

/** Strips the backticks Markdown wraps a code cell in. */
export function unquote(cell: string): string {
  return cell.replace(/`/g, '').trim()
}

/**
 * Returns the body rows of the README table whose header row starts with `headers`.
 *
 * @param headers - The leading header cells that identify the table.
 * @returns One array of cells per body row.
 * @throws Error When no table carries those headers, so a renamed header fails loudly.
 */
export function readmeTable(headers: readonly string[]): string[][] {
  const lines = PROSE.split('\n')
  const start = lines.findIndex((line) => {
    const cells = cellsOf(line)
    return line.startsWith('|') && cells.slice(0, headers.length).join('|') === headers.join('|')
  })
  if (start === -1) {
    throw new Error(`README has no table headed ${headers.join(' | ')}`)
  }
  const rows: string[][] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) {
      break
    }
    rows.push(cellsOf(line))
  }
  return rows
}
