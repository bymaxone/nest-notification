/**
 * @fileoverview Specs for the completion of Nodemailer's auth objects against stand-in transports:
 * what is added, what is kept, and what is left alone when a transport lacks a member.
 * @layer infrastructure
 */

import { AUTH_KEYS } from './nodemailer-keys'
import { shadowTransportAuth } from './smtp-auth-shadow'

/** Whether every name Nodemailer reads is an own key of the object. */
function isComplete(auth: object): boolean {
  return AUTH_KEYS.every((name) => Object.hasOwn(auth, name))
}

describe('shadowTransportAuth', () => {
  it('should complete the built auth in place and keep what it holds', () => {
    const auth = { type: 'LOGIN', user: 'u' }

    shadowTransportAuth({ transporter: { auth } })

    expect(isComplete(auth)).toBe(true)
    expect(auth).toMatchObject({ type: 'LOGIN', user: 'u' })
  })

  it.each([
    ['false', false],
    ['undefined', undefined],
    ['null', null]
  ])('should leave an auth of %s as it is', (_label, auth) => {
    const transporter = { auth }

    shadowTransportAuth({ transporter })

    expect(transporter.auth).toBe(auth)
  })

  it('should complete what getAuth answers, passing the arguments and the receiver on', () => {
    const built = { type: 'LOGIN' }
    const transporter = {
      marker: 'own',
      getAuth(this: { marker: string }, options: unknown): object {
        return Object.assign(built, { seen: [this.marker, options] })
      }
    }

    shadowTransportAuth({ transporter })
    const answered = (transporter.getAuth as (options: unknown) => object).call(
      transporter,
      'per-call'
    )

    expect(answered).toBe(built)
    expect(answered).toMatchObject({ seen: ['own', 'per-call'] })
    expect(isComplete(answered)).toBe(true)
  })

  it('should answer the auth it holds, building nothing, when the options add nothing', () => {
    const auth = { type: 'LOGIN' }
    const build = jest.fn(() => ({ type: 'OTHER' }))
    const transporter = { auth, getAuth: build as (options?: unknown) => unknown }

    shadowTransportAuth({ transporter })

    expect(transporter.getAuth({})).toBe(auth)
    expect(build).not.toHaveBeenCalled()
  })

  it.each([
    ['no options', []],
    ['null', [null]],
    ['a value that is not an object', [0]],
    ['options of the call', [{ user: 'per-call' }]]
  ])('should build when getAuth is given %s', (_label, args: unknown[]) => {
    const built = { type: 'OTHER' }
    const transporter = {
      auth: { type: 'LOGIN' },
      getAuth: (..._options: unknown[]): unknown => built
    }

    shadowTransportAuth({ transporter })

    expect(transporter.getAuth(...args)).toBe(built)
  })

  it.each([
    ['holds none', {}],
    ['holds a false one', { auth: false }],
    ['only inherits one', Object.create({ auth: { type: 'LOGIN' } }) as object]
  ])('should build when the transport %s', (_label, holder) => {
    const built = { type: 'OTHER' }
    const transporter = Object.assign(holder, { getAuth: (_options: unknown): unknown => built })

    shadowTransportAuth({ transporter })

    expect(transporter.getAuth({})).toBe(built)
  })

  it('should complete the auth of each connection a pool creates', () => {
    const connection = { auth: { type: 'LOGIN' } }
    const transporter = {
      marker: 'own',
      _createConnection(this: { marker: string }, entry: unknown): typeof connection {
        return Object.assign(connection, { seen: [this.marker, entry] })
      }
    }

    shadowTransportAuth({ transporter })
    const created = (transporter._createConnection as (entry: unknown) => object).call(
      transporter,
      'queued'
    )

    expect(created).toBe(connection)
    expect(created).toMatchObject({ seen: ['own', 'queued'] })
    expect(isComplete(connection.auth)).toBe(true)
  })

  it('should add no member a transport does not have', () => {
    const transporter = {}

    shadowTransportAuth({ transporter })

    expect(Object.keys(transporter)).toEqual([])
  })

  it('should leave a stand-in without a transporter of its own alone', () => {
    const auth = { type: 'LOGIN' }
    const standIn = Object.create({ transporter: { auth } }) as object

    shadowTransportAuth(standIn)

    expect(Object.keys(auth)).toEqual(['type'])
  })
})
