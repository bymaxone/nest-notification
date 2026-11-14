/**
 * @fileoverview Holds `collectEchoedExcerpts` to a cost that grows with the size of its inputs and
 * not with the number of places a repeated run occurs in them, and to the same answers as the
 * straightforward definition it replaced.
 * @layer domain
 */

import {
  MAX_ECHO_SCAN_LENGTH,
  MAX_ERROR_CHAIN_LINKS,
  MIN_ECHO_LENGTH,
  collectEchoedExcerpts,
  collectErrorChainMessages,
  inspectErrorChain
} from './redact'

/**
 * The definition, written the obvious way: at each position, find every occurrence of the window in
 * the reference, extend each one, keep the longest. Quadratic on a repeated run, which is why it
 * is only the oracle here.
 */
function referenceExcerpts(text: string, reference: string): string[] {
  const excerpts: string[] = []
  let index = 0
  while (index + MIN_ECHO_LENGTH <= text.length) {
    const window = text.slice(index, index + MIN_ECHO_LENGTH)
    let longest = 0
    for (let at = reference.indexOf(window); at !== -1; at = reference.indexOf(window, at + 1)) {
      let length = MIN_ECHO_LENGTH
      while (index + length < text.length && text[index + length] === reference[at + length]) {
        length += 1
      }
      longest = Math.max(longest, length)
    }
    if (longest === 0) {
      index += 1
      continue
    }
    excerpts.push(text.slice(index, index + longest))
    index += longest
  }
  return excerpts
}

/** A small deterministic generator, so a failing case can be replayed. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

/** A string over a tiny alphabet, which is what makes repeats and partial matches frequent. */
function randomText(random: () => number, length: number, alphabet: string): string {
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
}

describe('collectEchoedExcerpts cost', () => {
  // A relay that quotes a body made of one long run sends every window to every position: the
  // direct definition spent 4.2 s on a 40000-character body and 21.6 s on 80000.
  it('should scrub a repeated body at the largest scanned size in a few seconds at most', () => {
    const body = 'a'.repeat(MAX_ECHO_SCAN_LENGTH - 20)
    const message = `550 rejected: ${body}`

    const started = performance.now()
    const excerpts = collectEchoedExcerpts(message, body)
    const elapsed = performance.now() - started

    expect(excerpts).toEqual([body])
    expect(elapsed).toBeLessThan(3_000)
  })

  it('should stay linear when the body is a short repeated pattern', () => {
    const body = 'abcdefghij'.repeat(6_000)
    const message = `rejected: ${body}`

    const started = performance.now()
    const excerpts = collectEchoedExcerpts(message, body)
    const elapsed = performance.now() - started

    expect(excerpts.join('')).toBe(body)
    expect(elapsed).toBeLessThan(3_000)
  })

  // An error that large is relay-controlled, and indexing it costs memory in proportion: it is
  // scrubbed whole instead, which can only remove more than it needs to.
  it('should return an error text longer than the scan limit whole', () => {
    const message = `550 rejected: ${'x'.repeat(MAX_ECHO_SCAN_LENGTH)}`

    expect(collectEchoedExcerpts(message, 'an unrelated body of ordinary length')).toEqual([
      message
    ])
    expect(
      collectEchoedExcerpts(message.slice(0, MAX_ECHO_SCAN_LENGTH), 'unrelated body text')
    ).toEqual([])
  })

  it('should read a large body with no echo in time proportional to its size', () => {
    const body = 'lorem ipsum dolor '.repeat(80_000)

    const started = performance.now()
    const excerpts = collectEchoedExcerpts('550 5.7.1 message rejected by policy', body)
    const elapsed = performance.now() - started

    expect(excerpts).toEqual([])
    expect(elapsed).toBeLessThan(3_000)
  })
})

describe('collectEchoedExcerpts answers', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'should give the same excerpts as the direct definition (seed %i)',
    (seed) => {
      const random = lcg(seed)
      for (let round = 0; round < 40; round += 1) {
        const alphabet = ['ab', 'abc', 'abcdefgh', 'abcdefghijklmnopqrstuvwxyz '][
          round % 4
        ] as string
        const reference = randomText(random, 20 + Math.floor(random() * 200), alphabet)
        const text = randomText(random, 10 + Math.floor(random() * 120), alphabet)
        // Splice a slice of the reference into the text so that real echoes occur.
        const start = Math.floor(random() * reference.length)
        const echoed = reference.slice(start, start + 12 + Math.floor(random() * 60))
        const message = `${text.slice(0, 5)}${echoed}${text.slice(5)}`

        expect(collectEchoedExcerpts(message, reference)).toEqual(
          referenceExcerpts(message, reference)
        )
      }
    }
  )

  // A message that quotes several slices of the reference, each followed by something else: the
  // longest match at a position then sits at a different place than the shorter ones that
  // overlap it, which is the shape that exercises both directions of the suffix-link walk.
  it.each([11, 12, 13, 14, 15, 16])(
    'should give the same excerpts for a message built from slices of the reference (seed %i)',
    (seed) => {
      const random = lcg(seed)
      for (let round = 0; round < 60; round += 1) {
        const alphabet = ['abc', 'abcd', 'abcdef'][round % 3] as string
        const reference = randomText(random, 150 + Math.floor(random() * 250), alphabet)
        let message = ''
        for (let piece = 0; piece < 6; piece += 1) {
          const start = Math.floor(random() * reference.length)
          message += reference.slice(start, start + 8 + Math.floor(random() * 40))
          message += randomText(random, Math.floor(random() * 4), alphabet)
        }

        expect(collectEchoedExcerpts(message, reference)).toEqual(
          referenceExcerpts(message, reference)
        )
      }
    }
  )

  // Two cases found by searching for inputs on which visiting the suffix-link tree out of order
  // changes the answer: the match has to travel through more than one level before it reaches
  // the position that needs it.
  it.each([
    [
      'bbcabcbababbcaccacbaaaaacbbaccabcbbbcccccabcababcaacacababacbabccaaccbbcccbbaccbbbabbcbc',
      'cbbaccabcbbbcccccabcababcaacacababacbabccaaccbbbcbbbcccccabcababcccccabcababcaacacababacbabccaaccbaaabcbbbcccccabcababcaacacababacbabccaa'
    ],
    [
      'ccccabaabdcbbbbcbbaacaaadacbcdbbbbaddaccdbadabaaabddccdcddddbacdbdaaaabcbdbcbdbbbccbcbcbaddbcc',
      'abcbdbcbdbbbccbcbcbaddbccccbdbbbccbcbcbaddbccdaabdcbbbbcbbaacaaadacbcdbbbbaddaccacddbacdbdaaaabcbdbcbdbbbccbcbcbaddbccda'
    ]
  ])(
    'should give the same excerpts when a match crosses several levels (%#)',
    (reference, message) => {
      expect(collectEchoedExcerpts(message, reference)).toEqual(
        referenceExcerpts(message, reference)
      )
    }
  )

  // A long echo of unique content, which is what a relay quoting a real body looks like: the one
  // match is far longer than the window and sits in the middle of the reference.
  it('should find a single long echo in the middle of unrelated content', () => {
    const random = lcg(99)
    const reference = randomText(random, 3_000, 'abcdefghijklmnopqrstuvwxyz ')
    const echoed = reference.slice(1_200, 1_260)
    const message = `550 5.7.1 rejected: ${echoed} (policy)`

    expect(collectEchoedExcerpts(message, reference)).toEqual(referenceExcerpts(message, reference))
    expect(collectEchoedExcerpts(message, reference).some((e) => e.includes(echoed))).toBe(true)
  })

  it('should match the direct definition at the window boundary', () => {
    const reference = 'x'.repeat(MIN_ECHO_LENGTH - 1) + 'y' + 'x'.repeat(MIN_ECHO_LENGTH)
    for (const message of [
      'x'.repeat(MIN_ECHO_LENGTH),
      'x'.repeat(MIN_ECHO_LENGTH - 1),
      'x'.repeat(MIN_ECHO_LENGTH + 1),
      `${'x'.repeat(MIN_ECHO_LENGTH - 1)}y${'x'.repeat(MIN_ECHO_LENGTH)}`,
      ''
    ]) {
      expect(collectEchoedExcerpts(message, reference)).toEqual(
        referenceExcerpts(message, reference)
      )
    }
  })

  it('should give no excerpts for an empty reference or an empty text', () => {
    expect(collectEchoedExcerpts('some error text of reasonable length', '')).toEqual([])
    expect(collectEchoedExcerpts('', 'some reference text of reasonable length')).toEqual([])
  })
})

describe('collectEchoedExcerpts over several fields', () => {
  it('should find the same excerpts in each field as scanning the fields one by one', () => {
    const random = lcg(5)
    const reference = randomText(random, 400, 'abcdefghijklmnop ')
    const fields = Array.from({ length: 6 }, (_, index) => {
      const start = Math.floor(random() * 300)
      return `${randomText(random, 5, 'xyz')}${reference.slice(start, start + 20 + index * 9)}${randomText(random, 4, 'xyz')}`
    })

    expect(collectEchoedExcerpts(fields, reference)).toEqual(
      fields.flatMap((field) => referenceExcerpts(field, reference))
    )
  })

  // A match that would run from the end of one field into the start of the next must stop at the
  // end of the field: each excerpt is later removed from the field it came from.
  it('should never return an excerpt that spans two fields', () => {
    const reference = 'the quick brown fox jumps over the lazy dog'
    const fields = ['the quick brown fox ju', 'mps over the lazy dog']

    const excerpts = collectEchoedExcerpts(fields, reference)

    expect(excerpts).toEqual(['the quick brown fox ju', 'mps over the lazy dog'])
    for (const excerpt of excerpts) {
      expect(fields.some((field) => field.includes(excerpt))).toBe(true)
    }
  })

  it('should return the fields that no longer fit in the scan budget whole', () => {
    const fits = 'x'.repeat(MAX_ECHO_SCAN_LENGTH - 10)
    const over = 'reset code 998877 and more'

    const excerpts = collectEchoedExcerpts([fits, over], 'an unrelated body of ordinary length')

    expect(excerpts).toEqual([over])
  })

  // A field shorter than the window cannot hold an echo, so it is never worth returning whole.
  it('should not return a short field past the scan budget', () => {
    const fits = 'x'.repeat(MAX_ECHO_SCAN_LENGTH)
    const short = 'x'.repeat(MIN_ECHO_LENGTH - 1)
    const long = 'y'.repeat(MIN_ECHO_LENGTH)

    expect(collectEchoedExcerpts([fits, short, long], 'an unrelated body of text')).toEqual([long])
  })

  // The list of whole fields is as long as the chain, which a provider chooses.
  it('should return a very long list of whole fields without error', () => {
    const fits = 'x'.repeat(MAX_ECHO_SCAN_LENGTH)
    const many = Array.from({ length: 200_000 }, (_, index) => `field number ${String(index)} long`)

    expect(collectEchoedExcerpts([fits, ...many], 'an unrelated body of text')).toHaveLength(
      many.length
    )
  })
})

/** A chain of `links` errors with one-line stacks. */
function chain(links: number, size = 10): Error {
  let error = new Error('x'.repeat(size))
  error.stack = 'Error'
  for (let link = 1; link < links; link += 1) {
    error = new Error(`link ${String(link)} `.padEnd(size, 'x'), { cause: error })
    error.stack = 'Error'
  }
  return error
}

describe('inspectErrorChain', () => {
  it('should read every link of a chain inside the window, message and stack apart', () => {
    const window = inspectErrorChain(chain(MAX_ERROR_CHAIN_LINKS))

    expect(window.withheld).toBe(false)
    expect(window.parts).toHaveLength(MAX_ERROR_CHAIN_LINKS * 2)
  })

  it('should stop after the window and withhold a chain that continues past it', () => {
    const window = inspectErrorChain(chain(MAX_ERROR_CHAIN_LINKS + 1))

    expect(window.withheld).toBe(true)
    expect(window.parts).toHaveLength(MAX_ERROR_CHAIN_LINKS * 2)
  })

  it('should read a chain of 100000 links by reading only the window', () => {
    const started = performance.now()
    const window = inspectErrorChain(chain(100_000))
    const elapsed = performance.now() - started

    expect(window.withheld).toBe(true)
    expect(window.parts).toHaveLength(MAX_ERROR_CHAIN_LINKS * 2)
    // Building the chain is in the measurement; reading it is not what grows.
    expect(elapsed).toBeLessThan(3_000)
  })

  it('should withhold a chain whose text is longer than the scan limit', () => {
    expect(inspectErrorChain(new Error('x'.repeat(MAX_ECHO_SCAN_LENGTH + 1))).withheld).toBe(true)
    expect(inspectErrorChain(new Error('x'.repeat(100))).withheld).toBe(false)
  })

  it('should not withhold a chain that loops back on itself', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    ;(first as { cause?: unknown }).cause = second

    const window = inspectErrorChain(first)

    expect(window.withheld).toBe(false)
    expect(window.parts.filter((part) => part === 'first' || part === 'second')).toEqual([
      'first',
      'second'
    ])
  })

  it('should read only the window of messages for the reply-code grammar', () => {
    const messages = collectErrorChainMessages(chain(MAX_ERROR_CHAIN_LINKS * 4))

    expect(messages.split('\n')).toHaveLength(MAX_ERROR_CHAIN_LINKS)
  })
})
