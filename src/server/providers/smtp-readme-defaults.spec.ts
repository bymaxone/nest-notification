import { readmeTable, unquote } from '../config/__tests__/readme-tables'

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockCreateTransport = jest.fn()

// `nodemailer` is an optional peer dep that is not installed; the virtual flag lets jest
// register a mock for the lazy `import('nodemailer')`.
jest.mock(
  'nodemailer',
  () => ({ __esModule: true, createTransport: (config: unknown) => mockCreateTransport(config) }),
  { virtual: true }
)

// The README's SMTP option table is what a consumer reads as the contract. These cases parse it
// and hold each stated default to the transport configuration the provider actually builds.

const table = readmeTable(['Option', 'Default', 'Notes'])
const rows = new Map(
  table.map(([option = '', fallback = '']) => [unquote(option), unquote(fallback)])
)
const notes = new Map(table.map(([option = '', , note = '']) => [unquote(option), note]))

/** The transport config handed to `createTransport` for a provider built from `options`. */
async function transportFor(
  options: ConstructorParameters<typeof SmtpEmailProvider>[0]
): Promise<Record<string, unknown>> {
  mockCreateTransport.mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: '<a>' })
  })
  await new SmtpEmailProvider(options).send(baseOptions)
  return mockCreateTransport.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

/** Converts a README duration such as `10s` to milliseconds. */
function seconds(cell: string): number {
  return Number(cell.replace(/s$/, '')) * 1000
}

describe('README SMTP option table', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // A table that parses to nothing would let every case below pass vacuously.
  it('should list the options a consumer passes to the provider', () => {
    expect([...rows.keys()]).toEqual(
      expect.arrayContaining(['host', 'port', 'secure', 'requireTls', 'credentials', 'tls'])
    )
  })

  // `host` is the one required option: the README says so, and without it the provider reports
  // itself unconfigured and refuses to send.
  it('should document host as required and refuse a send without it', async () => {
    const provider = new SmtpEmailProvider({})

    expect(notes.get('host')).toMatch(/^Required\./)
    expect(provider.isConfigured()).toBe(false)
    await expect(provider.send(baseOptions)).rejects.toThrow()
  })

  // The port default is the submission port.
  it('should document the default port', async () => {
    const config = await transportFor({ host: 'smtp.acme.com' })

    expect(rows.get('port')).toBe(String(config['port']))
  })

  // `secure` follows the port: implicit TLS exactly on 465, never on the default.
  it('should document that implicit TLS follows port 465', async () => {
    const implicit = await transportFor({ host: 'smtp.acme.com', port: 465 })
    const submission = await transportFor({ host: 'smtp.acme.com', port: 587 })

    expect(rows.get('secure')).toBe('true iff port 465')
    expect([implicit['secure'], submission['secure']]).toEqual([true, false])
  })

  // STARTTLS is mandatory unless the connection is already encrypted or the host is loopback.
  it('should document when STARTTLS is mandatory by default', async () => {
    const remote = await transportFor({ host: 'smtp.acme.com' })
    const implicit = await transportFor({ host: 'smtp.acme.com', port: 465 })
    const loopback = await transportFor({ host: 'localhost', port: 1025 })

    expect(rows.get('requireTls')).toBe('true unless implicit TLS or loopback')
    expect([remote['requireTLS'], implicit['requireTLS'], loopback['requireTLS']]).toEqual([
      true,
      false,
      false
    ])
  })

  // An open relay is the default: no credentials means no auth block.
  it('should document an open relay when no credentials are given', async () => {
    const config = await transportFor({ host: 'smtp.acme.com' })

    expect(rows.get('credentials')).toBe('— (open relay)')
    expect(config['auth']).toBeUndefined()
  })

  // The three timeouts are bounded on purpose; the cell lists them in the header's order.
  it('should document the connection, greeting and socket timeouts', async () => {
    const config = await transportFor({ host: 'smtp.acme.com' })
    const documented = (rows.get('connectionTimeout / greetingTimeout / socketTimeout') ?? '')
      .split(' / ')
      .map(seconds)

    expect([
      config['connectionTimeout'],
      config['greetingTimeout'],
      config['socketTimeout']
    ]).toEqual(documented)
  })
})
