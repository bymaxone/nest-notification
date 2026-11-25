/**
 * @fileoverview Holds the Expo mapping helpers to placing a token once and reading a receipt only
 * from the service's own entries.
 * @layer infrastructure
 */

import { groupByProject, readReceipts, readTickets } from './expo-push.mapping'

describe('groupByProject', () => {
  it('should place a token that one list names twice once', () => {
    expect(groupByProject(['a', 'b'], { p1: ['a', 'a', 'b'] })).toStrictEqual([['a', 'b']])
  })

  it('should send a token that two lists name with the first list only', () => {
    expect(groupByProject(['a', 'b'], { p1: ['a'], p2: ['a', 'b'] })).toStrictEqual([['a'], ['b']])
  })

  it.each([null, 'x', 7, undefined])('should group nothing for details %j', (details) => {
    expect(groupByProject(['a'], details)).toStrictEqual([])
  })

  it('should leave out an unknown token and an entry that is not a string', () => {
    expect(groupByProject(['a'], { p1: ['z', 3, 'a'], p2: 'a' })).toStrictEqual([['a']])
  })
})

describe('readReceipts', () => {
  it('should read an id the data holds as its own entry only', () => {
    const data = Object.create({ inherited: { status: 'ok' } }) as object

    expect(readReceipts(['inherited'], { data })).toStrictEqual([
      expect.objectContaining({ status: 'pending' })
    ])
  })
})

describe('readTickets', () => {
  it('should refuse a ticket whose id is an empty string as a failure', () => {
    const [outcome] = readTickets(['a'], { data: [{ status: 'ok', id: '' }] })

    expect(outcome).toMatchObject({ token: 'a' })
    expect(outcome).toHaveProperty('reason')
  })

  it.each([
    ['fewer tickets than tokens', [{ status: 'ok', id: 'x' }]],
    [
      'more tickets than tokens',
      [
        { status: 'ok', id: 'x' },
        { status: 'ok', id: 'y' },
        { status: 'ok', id: 'z' }
      ]
    ]
  ])('should answer every token failed with %s', (_label, data) => {
    const outcomes = readTickets(['a', 'b'], { data })

    expect(outcomes.every((outcome) => 'reason' in outcome)).toBe(true)
  })
})
