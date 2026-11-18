/**
 * @fileoverview Holds SmtpEmailProvider.verify to what a readiness check needs: it asks the
 * transport to verify and sends nothing, it reuses the transport it built, it answers a failure
 * in fixed words that carry nothing of the relay's or of Nodemailer's text, and it is silent about a
 * transport that has no verify.
 * @layer infrastructure
 */

import { SmtpEmailProvider } from './smtp-email.provider'

const mockVerify = jest.fn()
const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn()

jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(true)
  mockCreateTransport.mockImplementation(() => ({
    sendMail: mockSendMail,
    verify: mockVerify,
    close: jest.fn()
  }))
})

describe('SmtpEmailProvider.verify', () => {
  it('should ask the transport to verify and send nothing', async () => {
    await expect(new SmtpEmailProvider({ host: 'relay.example' }).verify()).resolves.toBeUndefined()

    expect(mockVerify).toHaveBeenCalledTimes(1)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('should build the transport once and reuse it', async () => {
    const provider = new SmtpEmailProvider({ host: 'relay.example' })

    await provider.verify()
    await provider.verify()

    expect(mockCreateTransport).toHaveBeenCalledTimes(1)
    expect(mockVerify).toHaveBeenCalledTimes(2)
  })

  it('should answer a failure in fixed words, never the relay or Nodemailer text', async () => {
    mockVerify.mockRejectedValue(
      new Error('535 5.7.8 authentication failed for relay-user, pass relay-secret')
    )
    const failure = new SmtpEmailProvider({
      host: 'relay.example',
      credentials: { user: 'relay-user', pass: 'relay-secret' }
    }).verify()

    await expect(failure).rejects.toThrow(
      'SmtpEmailProvider: the relay did not accept the connection'
    )
    await expect(failure).rejects.not.toThrow(/relay-secret|535/)
  })

  it('should answer in the same words when the transport cannot be built', async () => {
    mockCreateTransport.mockImplementation(() => {
      throw new Error('cannot build, secret detail')
    })

    await expect(new SmtpEmailProvider({ host: 'relay.example' }).verify()).rejects.toThrow(
      'SmtpEmailProvider: the relay did not accept the connection'
    )
  })

  it('should resolve for a transport that has no verify', async () => {
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))

    await expect(new SmtpEmailProvider({ host: 'relay.example' }).verify()).resolves.toBeUndefined()
  })
})
