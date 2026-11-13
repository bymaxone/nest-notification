/**
 * @fileoverview Holds `collectEchoedExcerpts` to a cost that grows with the size of its inputs and
 * not with the number of places a repeated run occurs in them, and to the same answers as the
 * straightforward definition it replaced.
 * @layer domain
 */

import { MIN_ECHO_LENGTH, collectEchoedExcerpts } from './redact'

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
  it('should scrub an 80000-character repeated body in well under a second', () => {
    const body = 'a'.repeat(80_000)
    const message = `550 rejected: ${body}`

    const started = performance.now()
    const excerpts = collectEchoedExcerpts(message, body)
    const elapsed = performance.now() - started

    expect(excerpts).toEqual([body])
    expect(elapsed).toBeLessThan(500)
  })

  it('should stay linear when the body is a short repeated pattern', () => {
    const body = 'abcdefghij'.repeat(8_000)
    const message = `rejected: ${body}`

    const started = performance.now()
    const excerpts = collectEchoedExcerpts(message, body)
    const elapsed = performance.now() - started

    expect(excerpts.join('')).toBe(body)
    expect(elapsed).toBeLessThan(500)
  })

  it('should read a large body with no echo in time proportional to its size', () => {
    const body = 'lorem ipsum dolor '.repeat(80_000)

    const started = performance.now()
    const excerpts = collectEchoedExcerpts('550 5.7.1 message rejected by policy', body)
    const elapsed = performance.now() - started

    expect(excerpts).toEqual([])
    expect(elapsed).toBeLessThan(1_000)
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
