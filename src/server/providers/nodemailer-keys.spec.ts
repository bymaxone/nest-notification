/**
 * @fileoverview Holds `ownTlsKeys` to what it promises: an options object gets an own key for every
 * name `tls.connect` reads, with Node's defaults where Node validates the value, and a value that is
 * not an options object is left to the transport as it is.
 * @layer infrastructure
 */

import { ownTlsKeys, TLS_KEYS } from './nodemailer-keys'

describe('ownTlsKeys', () => {
  it.each([['x'], [5], [true]])(
    'should hand a value that is not an object back as it is: %s',
    (value) => {
      expect(ownTlsKeys(value)).toBe(value)
    }
  )

  it('should hand an array and null back as they are', () => {
    const list: string[] = []

    expect(ownTlsKeys(list)).toBe(list)
    expect(ownTlsKeys(null)).toBeNull()
  })

  it('should give an options object an own key for every name, and Node defaults for the two it checks', () => {
    const own = ownTlsKeys({ ca: 'pem' } as Record<string, unknown>)

    for (const name of TLS_KEYS) {
      expect(Object.hasOwn(own, name)).toBe(true)
    }
    // Names Node reads, which the list must hold, whatever else it holds.
    for (const name of [
      'rejectUnauthorized',
      'servername',
      'minVersion',
      'path',
      'localAddress',
      'onread'
    ]) {
      expect(Object.hasOwn(own, name)).toBe(true)
    }
    expect(own.ca).toBe('pem')
    expect(typeof own.checkServerIdentity).toBe('function')
    expect(own.minDHSize).toBe(1024)
    expect(own.rejectUnauthorized).toBeUndefined()
  })

  it('should give an unset value the same keys', () => {
    const own = ownTlsKeys(undefined as Record<string, unknown> | undefined)

    expect(Object.hasOwn(own ?? {}, 'rejectUnauthorized')).toBe(true)
  })
})
