/**
 * @fileoverview Specifies `escapeAuditEntry`: no string leaves the audit writer with a character
 * that can start a second log record or reorder how a line is displayed, in any field of an entry
 * and at any depth of its metadata, and nothing else is changed.
 * @layer utils
 */

import type { NotificationLogEntry } from '../interfaces/notification-log-repository.interface'

import {
  CIRCULAR_MARKER,
  DEPTH_LIMIT_MARKER,
  MAX_METADATA_DEPTH,
  NON_PLAIN_MARKER,
  escapeAuditEntry,
  escapeAuditString
} from './audit-escape'

const entry = (overrides: Partial<NotificationLogEntry> = {}): NotificationLogEntry => ({
  timestamp: 1_700_000_000_000,
  tenantId: 'tenant_a',
  channel: 'otp',
  verb: 'sent',
  recipient: 'jane@acme.com',
  providerName: 'memory',
  ...overrides
})

/** The characters that are escaped, written out here and not derived from the code under test. */
const IN_SET = (code: number): boolean =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0x061c ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069)

describe('escapeAuditString', () => {
  it.each([
    ['a line feed', 'a\nb', 'a\\nb'],
    ['a carriage return', 'a\rb', 'a\\rb'],
    ['a tab', 'a\tb', 'a\\tb'],
    ['a NUL', 'a\u0000b', 'a\\u0000b'],
    ['an escape', 'a\u001bb', 'a\\u001bb'],
    ['DEL', 'a\u007fb', 'a\\u007fb'],
    ['NEL', 'a\u0085b', 'a\\u0085b'],
    ['the last C1 control', 'a\u009fb', 'a\\u009fb'],
    ['the line separator', 'a\u2028b', 'a\\u2028b'],
    ['the paragraph separator', 'a\u2029b', 'a\\u2029b'],
    ['a right-to-left override', 'a\u202eb', 'a\\u202eb'],
    ['a left-to-right mark', 'a\u200eb', 'a\\u200eb'],
    ['an isolate', 'a\u2067b', 'a\\u2067b'],
    ['an Arabic letter mark', 'a\u061cb', 'a\\u061cb'],
    ['CR LF', 'a\r\nb', 'a\\r\\nb'],
    ['several in a row', '\n\n\n', '\\n\\n\\n']
  ])('should escape %s with a visible sequence', (_label, input, expected) => {
    expect(escapeAuditString(input)).toBe(expected)
  })

  // The set is exactly the controls, the line and paragraph separators and the bidirectional
  // controls: every other BMP character, including letters of every script, is left as it is.
  it('should change exactly the characters in the set, over the whole basic plane', () => {
    const wrong: string[] = []
    for (let code = 0; code <= 0xffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) {
        continue
      }
      const character = String.fromCharCode(code)
      const changed = escapeAuditString(`a${character}b`) !== `a${character}b`
      if (changed !== IN_SET(code)) {
        wrong.push(`U+${code.toString(16)}`)
      }
    }

    expect(wrong).toEqual([])
  })

  it.each(['plain', 'jane@acme.com', 'ação ünï', '日本語', '😀', 'a\\nb', '', 'x'.repeat(10_000)])(
    'should leave %j as it is',
    (value) => {
      expect(escapeAuditString(value)).toBe(value)
    }
  )

  // A backslash is not escaped: the aim is that a value cannot start a record or reorder a line, not
  // that the escape can be undone, and a backslash is legitimate text.
  it('should not escape a backslash', () => {
    expect(escapeAuditString('C:\\temp\\new')).toBe('C:\\temp\\new')
  })

  it('should be idempotent', () => {
    const once = escapeAuditString('a\nb\u202ec\u0000')

    expect(escapeAuditString(once)).toBe(once)
  })
})

describe('escapeAuditEntry', () => {
  // One case per string field of an entry.
  it.each([
    'tenantId',
    'recipient',
    'purpose',
    'providerName',
    'messageId',
    'errorMessage',
    'userId',
    'deliveryEnhancedStatus'
  ] as const)('should escape the %s field', (field) => {
    const result = escapeAuditEntry(entry({ [field]: 'x\nforged' }))

    expect(result[field]).toBe('x\\nforged')
    expect(JSON.stringify(result)).not.toContain('\n')
  })

  it('should leave the other fields of the entry as they are', () => {
    const result = escapeAuditEntry(entry({ deliveryStatus: 550, userId: 'u1' }))

    expect(result).toEqual(entry({ deliveryStatus: 550, userId: 'u1' }))
  })

  it('should not change the entry it is given', () => {
    const input = entry({ recipient: 'a\nb', metadata: { note: 'x\ny' } })

    escapeAuditEntry(input)

    expect(input.recipient).toBe('a\nb')
    expect(input.metadata).toEqual({ note: 'x\ny' })
  })

  it('should return a new object', () => {
    const input = entry()

    expect(escapeAuditEntry(input)).not.toBe(input)
  })

  it('should be idempotent', () => {
    const once = escapeAuditEntry(entry({ recipient: 'a\nb', metadata: { n: ['x\r'] } }))

    expect(escapeAuditEntry(once)).toEqual(once)
  })

  // The markers are part of what a host reads in its log: their text is pinned here and in the README.
  it('should name the markers as documented', () => {
    expect(DEPTH_LIMIT_MARKER).toBe('[depth limit]')
    expect(CIRCULAR_MARKER).toBe('[circular]')
    expect(NON_PLAIN_MARKER).toBe('[non-plain value]')
    expect(MAX_METADATA_DEPTH).toBe(4)
  })

  describe('metadata', () => {
    it('should escape a string value', () => {
      expect(escapeAuditEntry(entry({ metadata: { note: 'x\ny' } })).metadata).toEqual({
        note: 'x\\ny'
      })
    })

    it('should escape a string value of a nested object', () => {
      expect(escapeAuditEntry(entry({ metadata: { a: { b: 'x\ny' } } })).metadata).toEqual({
        a: { b: 'x\\ny' }
      })
    })

    it('should escape the strings of an array', () => {
      expect(escapeAuditEntry(entry({ metadata: { list: ['a\nb', 3, 'c'] } })).metadata).toEqual({
        list: ['a\\nb', 3, 'c']
      })
    })

    it('should escape a key', () => {
      expect(escapeAuditEntry(entry({ metadata: { 'k\ney': 1 } })).metadata).toEqual({
        'k\\ney': 1
      })
    })

    it('should keep the values that are not strings', () => {
      const metadata = { n: 1, b: true, z: null, u: undefined, big: 10n }

      expect(escapeAuditEntry(entry({ metadata })).metadata).toEqual(metadata)
    })

    it('should keep an own __proto__ key as data', () => {
      const metadata = JSON.parse('{"__proto__": "x\\ny"}') as Record<string, unknown>

      const result = escapeAuditEntry(entry({ metadata })).metadata as Record<string, unknown>

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
      expect(Object.keys(result)).toEqual(['__proto__'])
      expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('x\\ny')
    })

    // The invariant is that no string leaves the writer with a raw control character: a subtree
    // that is too deep is replaced by a marker and never passed on as it is.
    it(`should replace a subtree deeper than ${String(MAX_METADATA_DEPTH)} levels with a marker`, () => {
      const deep = { a: { b: { c: { d: { e: { f: 'x\ny' } } } } } }

      const text = JSON.stringify(escapeAuditEntry(entry({ metadata: deep })))

      expect(text).not.toContain('\\n')
      expect(text).toContain(DEPTH_LIMIT_MARKER)
    })

    // metadata is level 1: its fourth nested container is at level 4, the last one that is kept.
    it('should keep an object at the deepest level that is kept, and mark the next one', () => {
      const result = escapeAuditEntry(
        entry({ metadata: { a: { b: { c: { s: 'x\ny', d: { s: 'z\nw' } } } } } })
      ).metadata

      expect(result).toEqual({ a: { b: { c: { s: 'x\\ny', d: DEPTH_LIMIT_MARKER } } } })
    })

    it('should count the arrays as levels too', () => {
      const result = escapeAuditEntry(entry({ metadata: { list: [[['x\ny']]] } })).metadata

      expect(result).toEqual({ list: [[['x\\ny']]] })
    })

    it('should mark an array that lies deeper than the limit', () => {
      const result = escapeAuditEntry(entry({ metadata: { list: [[[['x\ny']]]] } })).metadata

      expect(result).toEqual({ list: [[[DEPTH_LIMIT_MARKER]]] })
    })

    it('should keep a subtree exactly at the depth limit', () => {
      const atLimit = { a: { b: { c: 'x\ny' } } }

      expect(escapeAuditEntry(entry({ metadata: atLimit })).metadata).toEqual({
        a: { b: { c: 'x\\ny' } }
      })
    })

    it('should replace a string at depth 6 so that it does not appear raw', () => {
      const six = { l1: { l2: { l3: { l4: { l5: { l6: 'line\nbreak' } } } } } }

      const output = escapeAuditEntry(entry({ metadata: six }))

      expect(JSON.stringify(output)).not.toContain('line\\nbreak')
      expect(JSON.stringify(output)).not.toContain('break')
    })

    it('should replace a cycle with a marker', () => {
      const cycle: Record<string, unknown> = { name: 'x\ny' }
      cycle['self'] = cycle

      const result = escapeAuditEntry(entry({ metadata: cycle })).metadata

      expect(result).toEqual({ name: 'x\\ny', self: CIRCULAR_MARKER })
    })

    it('should escape a value that is shared and not a cycle, at every place it appears', () => {
      const shared = { s: 'x\ny' }

      expect(escapeAuditEntry(entry({ metadata: { one: shared, two: shared } })).metadata).toEqual({
        one: { s: 'x\\ny' },
        two: { s: 'x\\ny' }
      })
    })

    it.each([
      [
        'a class instance',
        new (class Holder {
          value = 'x\ny'
        })()
      ],
      ['a Map', new Map([['k', 'x\ny']])],
      ['a Date', new Date(0)],
      ['a function', () => 'x\ny'],
      ['a symbol', Symbol('x\ny')]
    ])('should replace %s with a marker', (_label, value) => {
      const result = escapeAuditEntry(entry({ metadata: { value } })).metadata

      expect(result).toEqual({ value: NON_PLAIN_MARKER })
    })

    it('should accept an object without a prototype as a plain object', () => {
      const bare = Object.assign(Object.create(null) as Record<string, unknown>, { s: 'x\ny' })

      expect(escapeAuditEntry(entry({ metadata: { bare } })).metadata).toEqual({
        bare: { s: 'x\\ny' }
      })
    })

    it('should not add a metadata field to an entry that has none', () => {
      expect(escapeAuditEntry(entry())).not.toHaveProperty('metadata')
    })
  })
})
