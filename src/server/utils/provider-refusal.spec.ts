/**
 * @fileoverview Holds `rethrowRefusal` to naming the component that refuses, so a push refusal does
 * not say `[EmailService]`.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

import { refuseInput } from './bounded-list'
import { rethrowRefusal } from './provider-refusal'

describe('rethrowRefusal', () => {
  it.each(['PushService', 'EmailService'])('should name %s in the refusal it throws', (owner) => {
    const refused = refuseInput('Adapter', 'message', 'secret provider words')

    let thrown: unknown
    try {
      rethrowRefusal(refused, owner)
    } catch (error) {
      thrown = error
    }

    expect((thrown as NotificationException).getResponse()).toMatchObject({
      error: { details: { boundary: owner, parameter: 'message' } }
    })
    expect(JSON.stringify((thrown as NotificationException).getResponse())).not.toContain(
      'secret provider words'
    )
  })

  it('should return for an error that is not a refusal', () => {
    expect(() => {
      rethrowRefusal(new Error('boom'), 'PushService')
      rethrowRefusal(new NotificationException('PUSH_SEND_FAILED'), 'PushService')
    }).not.toThrow()
  })
})
