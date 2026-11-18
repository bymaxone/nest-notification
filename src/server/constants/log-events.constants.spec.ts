/**
 * @fileoverview Holds the log events to one set: every event has the `NOTIFICATION_` shape and is
 * unique, is written by some line of the source, and is a row of the README's "Log events" table,
 * and every row of that table is an event.
 * @layer constants
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { NOTIFICATION_LOG_EVENTS } from './log-events.constants'

const ROOT = join(__dirname, '..', '..', '..')

/** Every source file of the server entry that is not a spec, as `[path, text]`. */
function sources(directory: string): Array<[string, string]> {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      return sources(path)
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts')
      ? [[path, readFileSync(path, 'utf8')]]
      : []
  })
}

describe('NOTIFICATION_LOG_EVENTS', () => {
  const events = Object.entries(NOTIFICATION_LOG_EVENTS)
  const readmeText = readFileSync(join(ROOT, 'README.md'), 'utf8')
  // The "Log events" subsection only: other tables name exported constants of the same prefix.
  const start = readmeText.indexOf('### Log events')
  const readme = readmeText.slice(start, readmeText.indexOf('\n## ', start))
  const files = sources(join(ROOT, 'src', 'server')).filter(
    ([path]) => !path.endsWith('log-events.constants.ts')
  )

  it('should name every event NOTIFICATION_ and the key, in upper snake case', () => {
    for (const [key, value] of events) {
      expect(value).toBe(`NOTIFICATION_${key}`)
      expect(value).toMatch(/^NOTIFICATION_[A-Z]+(_[A-Z]+)*$/)
    }
    expect(new Set(events.map(([, value]) => value)).size).toBe(events.length)
  })

  it.each(events)('should write the %s event from some line of the source', (key) => {
    const used = files.some(([, text]) => text.includes(`NOTIFICATION_LOG_EVENTS.${key}`))

    expect(used).toBe(true)
  })

  it.each(events)('should list the %s event as a row of the README table', (_key, value) => {
    expect(readme).toMatch(new RegExp(`^\\| \`${value}\` +\\|`, 'm'))
  })

  it('should list in the README table only events that exist', () => {
    const rows = [...readme.matchAll(/^\| `(NOTIFICATION_[A-Z_]+)` +\|/gm)].map((match) => match[1])

    expect([...rows].sort()).toEqual(events.map(([, value]) => value).sort())
  })
})
