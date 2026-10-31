import type { IEmailProvider } from '../interfaces/email-provider.interface'
import type { INotificationLogRepository } from '../interfaces/notification-log-repository.interface'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import type { BymaxNotificationModuleOptions } from '../interfaces/notification-module-options.interface'

import { readmeTable, unquote } from './__tests__/readme-tables'
import { OTP_MAX_LENGTH, OTP_MIN_LENGTH } from './default-options'
import { resolveOptions } from './resolved-options'
import { validateOptions } from './validate-options'

// The README's Configuration table is what a consumer reads as the contract. These cases parse
// it and hold every stated default and every "required" marker to the code, so the next drift
// fails here instead of shipping to npm.

/** A minimal valid configuration: every channel present, nothing optional set. */
function minimalOptions(): BymaxNotificationModuleOptions {
  return {
    email: {
      provider: { name: 'stub' } as unknown as IEmailProvider,
      defaultFrom: 'noreply@example.com'
    },
    otp: { storage: { name: 'stub' } as unknown as IOtpStorage },
    audit: { repository: { name: 'stub' } as unknown as INotificationLogRepository }
  }
}

const rows = readmeTable(['Section', 'Option', 'Default', 'Notes']).map(
  ([section = '', option = '', fallback = '', notes = '']) => ({
    section: unquote(section),
    option: unquote(option),
    fallback: unquote(fallback),
    notes
  })
)

/** Reads the resolved value a README row documents. */
function resolvedValue(section: string, option: string): unknown {
  const resolved = resolveOptions(minimalOptions())
  const sectionValue = (resolved as unknown as Record<string, Record<string, unknown>>)[section]
  return sectionValue?.[option]
}

/** Parses a literal default cell: `'text'`, a number, `true`/`false`, or `{}`. */
function parseLiteral(cell: string): unknown {
  if (/^'.*'$/.test(cell)) {
    return cell.slice(1, -1)
  }
  if (/^-?\d+$/.test(cell)) {
    return Number(cell)
  }
  if (cell === 'true' || cell === 'false') {
    return cell === 'true'
  }
  if (cell === '{}') {
    return {}
  }
  return undefined
}

const literalRows = rows.filter((row) => parseLiteral(row.fallback) !== undefined)
const requiredRows = rows.filter((row) => row.fallback.startsWith('— (required)'))

describe('README Configuration table', () => {
  // A table that parses to nothing would let every case below pass vacuously.
  it('should list the sections and options a consumer configures', () => {
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(literalRows.length).toBeGreaterThanOrEqual(8)
    expect(requiredRows.length).toBeGreaterThanOrEqual(4)
  })

  // The README states these as defaults; the resolver is what a running module applies.
  it.each(literalRows.map((row) => [`${row.section}.${row.option}`, row] as const))(
    'should document the resolved default of %s',
    (_name, row) => {
      expect(resolvedValue(row.section, row.option)).toEqual(parseLiteral(row.fallback))
    }
  )

  // "— (required)" is a claim that omitting the option is refused at startup.
  it.each(requiredRows.map((row) => [`${row.section}.${row.option}`, row] as const))(
    'should refuse a configuration without the required %s',
    (_name, row) => {
      const options = minimalOptions() as unknown as Record<string, Record<string, unknown>>
      delete options[row.section]?.[row.option]

      expect(() => validateOptions(options as unknown as BymaxNotificationModuleOptions)).toThrow()
    }
  )

  // The Notes cell states the accepted OTP length; it must be the validator's range.
  it('should state the OTP length range the validator enforces', () => {
    const row = rows.find((r) => r.section === 'otp' && r.option === 'defaultLength')

    expect(row?.notes).toContain(`${OTP_MIN_LENGTH}–${OTP_MAX_LENGTH}`)
  })

  // The audit mask default is documented as "identity": the recipient reaches the sink unchanged.
  it('should document an identity maskRecipient default', () => {
    const row = rows.find((r) => r.section === 'audit' && r.option === 'maskRecipient')
    const mask = resolveOptions(minimalOptions()).audit.maskRecipient

    expect(row?.fallback).toBe('identity')
    expect(mask('jane@acme.com')).toBe('jane@acme.com')
  })
})
