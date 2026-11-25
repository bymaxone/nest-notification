/**
 * @fileoverview Pins the closed value sets of the observability subpath to the values consumers
 * build dashboards and alerts on. The other specs read these sets to build their expectations, so a
 * value dropped from a set would drop from them too; here each set is held to its literal members.
 * @layer observability
 */

import {
  NOTIFICATION_OTP_EVENTS,
  NOTIFICATION_SEND_CHANNELS,
  NOTIFICATION_SEND_OUTCOMES
} from './constants'

describe('the closed value sets a label draws from', () => {
  it('should list the channels a send is counted on', () => {
    expect([...NOTIFICATION_SEND_CHANNELS]).toEqual(['email', 'push'])
  })

  it('should list the outcomes a send ends in', () => {
    expect([...NOTIFICATION_SEND_OUTCOMES]).toEqual(['sent', 'failed', 'rejected'])
  })

  it('should list the events a code goes through', () => {
    expect([...NOTIFICATION_OTP_EVENTS]).toEqual(['issued', 'verified', 'failed', 'locked'])
  })
})
