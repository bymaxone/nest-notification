/**
 * @fileoverview Specs for the grammar-bounded reply-code extractor.
 * @layer domain
 */

import {
  extractDeliveryStatus,
  isBasicStatus,
  isEnhancedStatus,
  withoutDeclaredValues
} from './delivery-status'

describe('extractDeliveryStatus', () => {
  // The shape this exists for: a policy rejection quoting the whole body.
  // Everything the relay wrote is discarded; only the two codes survive.
  it('should publish the codes and none of the quoted body', () => {
    const body = 'Your password reset code is 883779. It expires shortly.'

    expect(extractDeliveryStatus(`550 5.7.1 refused by policy - body was: ${body}`)).toEqual({
      status: 550,
      enhanced: '5.7.1'
    })
  })

  // SECURITY: the output must not depend on the secret. The same reply
  // publishes the same two codes whatever the body carried — including a code
  // that collides with the status once punctuation is stripped (550571).
  it('should publish identically regardless of the code in the body', () => {
    const reply = (code: string): string => `550 5.7.1 refused: your code is ${code}`
    const expected = { status: 550, enhanced: '5.7.1' }

    expect(extractDeliveryStatus(reply('550571'))).toEqual(expected)
    expect(extractDeliveryStatus(reply('123456'))).toEqual(expected)
    expect(extractDeliveryStatus('550 5.7.1 refused')).toEqual(expected)
  })

  // The enhanced code is optional: a relay may answer with the basic one only,
  // and the absence must read as unknown rather than be inferred from prose.
  it('should return only the basic status when no enhanced code is present', () => {
    expect(extractDeliveryStatus('550 Rejected')).toEqual({ status: 550 })
  })

  // A body full of digits with no reply code yields nothing at all — the
  // extractor never invents a status to have something to say.
  it('should return an empty status when the text carries no reply code', () => {
    expect(extractDeliveryStatus('connect ECONNREFUSED 127.0.0.1:1099')).toEqual({})
  })

  // SECURITY: a cause chain can place two replies in one text. Picking either
  // would publish a value assembled from two different answers, so ambiguity
  // resolves to silence — per field, since one may be unambiguous while the
  // other is not.
  it('should publish nothing for a field the text makes ambiguous', () => {
    expect(extractDeliveryStatus('424 then 242')).toEqual({})
    expect(extractDeliveryStatus('550 5.7.1 then 552 5.2.2')).toEqual({})
    // Two mentions of the SAME reply are not ambiguity.
    expect(extractDeliveryStatus('550 5.7.1 (550 5.7.1 repeated)')).toEqual({
      status: 550,
      enhanced: '5.7.1'
    })
    // The basic code repeats consistently while the enhanced one conflicts:
    // the unambiguous half still publishes.
    expect(extractDeliveryStatus('550 5.7.1 and 550 5.7.28')).toEqual({ status: 550 })
  })

  // Only 2xx/4xx/5xx open an SMTP reply. A six-digit code beginning with 1, 3
  // or any other class is not a status and must not be read as one.
  it('should ignore digit runs outside the SMTP reply classes', () => {
    expect(extractDeliveryStatus('361966 and 100 and 399')).toEqual({})
  })

  // The boundaries matter: a three-digit run inside a longer number is part of
  // that number, not a reply code — otherwise any 6-digit OTP would parse as
  // one and the extractor would publish a fragment of the secret.
  it('should not read a status out of a longer digit run', () => {
    expect(extractDeliveryStatus('code 550123 and id 2451')).toEqual({})
    expect(extractDeliveryStatus('version 5.7.1.4')).toEqual({})
  })

  // A hostile relay can encode digits of its choosing into the grammar, so the
  // subfields are bounded at three digits — `5.4812.345` is not a status.
  it('should reject an enhanced code whose subfields exceed the bound', () => {
    expect(extractDeliveryStatus('550 5.4812.345 rejected')).toEqual({ status: 550 })
    // At the bound it is still a valid code.
    expect(extractDeliveryStatus('550 5.481.345 rejected')).toEqual({
      status: 550,
      enhanced: '5.481.345'
    })
  })

  // Absent fields must be genuinely absent, never `undefined` values — the
  // object is spread into exception details and an audit entry.
  it('should omit absent fields rather than setting them undefined', () => {
    const empty = extractDeliveryStatus('nothing here')
    const basicOnly = extractDeliveryStatus('421 service unavailable')

    expect('status' in empty).toBe(false)
    expect('enhanced' in empty).toBe(false)
    expect('enhanced' in basicOnly).toBe(false)
    expect('status' in basicOnly).toBe(true)
  })
})

describe('isBasicStatus', () => {
  // The validator exists because attached values come from provider code and
  // must clear the same bar the extractor applies to text.
  it('should accept only 2xx/4xx/5xx integers', () => {
    expect(isBasicStatus(550)).toBe(true)
    expect(isBasicStatus(421)).toBe(true)
    expect(isBasicStatus(250)).toBe(true)
    expect(isBasicStatus(100)).toBe(false)
    expect(isBasicStatus(35)).toBe(false)
    expect(isBasicStatus(5500)).toBe(false)
    expect(isBasicStatus(550.5)).toBe(false)
    expect(isBasicStatus(Number.NaN)).toBe(false)
  })
})

describe('isEnhancedStatus', () => {
  // Anchored end to end: a value that merely CONTAINS a code — the shape a
  // provider quoting the body would produce — must not pass.
  it('should accept only a complete enhanced code', () => {
    expect(isEnhancedStatus('5.7.1')).toBe(true)
    expect(isEnhancedStatus('4.481.345')).toBe(true)
    expect(isEnhancedStatus('5.7.1 rejected: your code is 998877')).toBe(false)
    expect(isEnhancedStatus('Your code is 998877')).toBe(false)
    expect(isEnhancedStatus('1.7.1')).toBe(false)
    expect(isEnhancedStatus('5.4812.345')).toBe(false)
  })
})

describe('withoutDeclaredValues', () => {
  // SECURITY: the invariant this protects is CONTAINMENT — the gate asserts a
  // code's characters never appear in an audit entry — so equality is not
  // enough. OTP lengths go down to one, and `55` sits inside a genuine `550`.
  it('should drop a code that CONTAINS a declared secret', () => {
    expect(withoutDeclaredValues({ status: 550, enhanced: '5.7.1' }, ['55'])).toStrictEqual({
      enhanced: '5.7.1'
    })
    expect(withoutDeclaredValues({ status: 421, enhanced: '5.7.1' }, ['7.1'])).toStrictEqual({
      status: 421
    })
  })

  // An exact match is the ordinary case and still drops.
  it('should drop a code that equals a declared secret', () => {
    expect(withoutDeclaredValues({ status: 550 }, ['550'])).toStrictEqual({})
  })

  // Nothing declared, nothing dropped — a deployment that declares no secrets
  // keeps its full diagnosis.
  it('should keep every code when nothing is declared', () => {
    const both = { status: 550, enhanced: '5.7.1' }

    expect(withoutDeclaredValues(both, undefined)).toStrictEqual(both)
    expect(withoutDeclaredValues(both, [])).toStrictEqual(both)
  })

  // An empty declared value is skipped: every string contains it, so honouring
  // it would drop every code for no gain.
  it('should ignore an empty declared value', () => {
    expect(withoutDeclaredValues({ status: 550 }, [''])).toStrictEqual({ status: 550 })
  })

  // Absent fields stay absent rather than becoming undefined-valued keys.
  it('should not invent keys for absent codes', () => {
    const only = withoutDeclaredValues({ enhanced: '5.7.1' }, ['999'])

    expect('status' in only).toBe(false)
    expect(only).toStrictEqual({ enhanced: '5.7.1' })
  })
})
