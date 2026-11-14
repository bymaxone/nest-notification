/**
 * @fileoverview Holds `collectEchoedExcerpts` to a cost that grows with the size of its inputs and
 * not with the number of places a repeated run occurs in them, and to the same answers as the
 * direct definition kept below as `referenceExcerpts`.
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

/**
 * The number of `Map` reads, writes and probes made while `run` executes. The matcher's work is
 * these operations, so counting them says how much work was done, which does not depend on how
 * busy the machine is the way a stopwatch does.
 */
function mapOperations(run: () => void): number {
  let operations = 0
  const counting = (name: 'get' | 'set' | 'has'): jest.SpyInstance => {
    const original = Map.prototype[name] as (...args: unknown[]) => unknown
    return jest.spyOn(Map.prototype, name).mockImplementation(function (
      this: Map<unknown, unknown>,
      ...args: unknown[]
    ) {
      operations += 1
      return original.apply(this, args)
    } as never)
  }
  const spies = [counting('get'), counting('set'), counting('has')]
  try {
    run()
  } finally {
    spies.forEach((spy) => spy.mockRestore())
  }
  return operations
}

/** Map operations per character of input the matcher may spend; it measures about 2 to 6. */
const OPERATIONS_PER_CHARACTER = 12

describe('collectEchoedExcerpts cost', () => {
  // A relay that quotes a body made of one long run sends every window to every position, which
  // is the input on which the cost of the direct definition grows with the square of its size.
  it('should scrub a repeated body at the largest scanned size with work linear in its size', () => {
    const body = 'a'.repeat(MAX_ECHO_SCAN_LENGTH - 20)
    const message = `550 rejected: ${body}`
    let excerpts: string[] = []

    const operations = mapOperations(() => {
      excerpts = collectEchoedExcerpts(message, body)
    })

    expect(excerpts).toEqual([body])
    expect(operations).toBeLessThan(OPERATIONS_PER_CHARACTER * (message.length + body.length))
  })

  it('should stay linear when the body is a short repeated pattern', () => {
    const body = 'abcdefghij'.repeat(6_000)
    const message = `rejected: ${body}`

    let excerpts: string[] = []

    const operations = mapOperations(() => {
      excerpts = collectEchoedExcerpts(message, body)
    })

    expect(excerpts.join('')).toBe(body)
    expect(operations).toBeLessThan(OPERATIONS_PER_CHARACTER * (message.length + body.length))
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

  it('should read a large body with no echo with work proportional to its size', () => {
    const body = 'lorem ipsum dolor '.repeat(80_000)
    const message = '550 5.7.1 message rejected by policy'
    let excerpts: string[] = []

    const operations = mapOperations(() => {
      excerpts = collectEchoedExcerpts(message, body)
    })

    expect(excerpts).toEqual([])
    expect(operations).toBeLessThan(OPERATIONS_PER_CHARACTER * (message.length + body.length))
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

  // Four cases found by searching, against the matcher as it is now, for inputs on which visiting the
  // suffix-link tree out of order changes the answer: the match has to travel through more than one
  // level before it reaches the position that needs it.
  it.each([
    [
      'abaaaabbbbbbaabaaabbaaaabaaaaabbababaaabbabbbbabbbaabaaabbbbaaaaaaaaabbabaababbaabababaaabbbbabbaaab',
      'ababaaabbabbbbabbbbbbaaaabaaaaabbababaaabbabbbbabbbaabaaababaabbbbbbaabaaabbaaaabaaaaabbababaaabbabbbbabbbababaaabbabbbbabbbaababb'
    ],
    [
      'bdbbcbcbbbdbcbbadcbdbaacbdbbcdbacbbcadaddcbcddacdbdbccbddcabccaaabcbcaaacbccbccabbaacabdcadbbddaabbabcddaaaabbbdcccdcdaddbbcbbddabaadadadbaaabbcdaaddbaacdaaa',
      'aabcbcaaacbccbccabbaacabdcadbbddaabbabcdddcabccaaabcbcaaacbccbccabbaacabdcadbbddbcaaacbccbccabbaacabdcadbbaadbccbddcabccaaabcbcaaacbccbccabbaacabdcadbbdd'
    ],
    [
      'abababbabaababbbbaabbbbabbaabbbbbbaaabbaaabaabaaabbbabaabaaabaaabbbbbbbbaabab',
      'baaabbaaabaabaaabbbabaabaaabaaabbbbbbbbaababaababbaabbbbbbaaabbaaabaabaaabbbabaabaaabaaabbbbaaabbaaabaabaaabbbabaabbabbaabbbbbbaaabbaaabaabaaabbbabaabaaab'
    ],
    [
      'acdadbacdadabaacaadbaabccccbabcdccccccdcdcccadababdddccbaaaacaccdabbaaddbbaca',
      'dababdddccbaaaacaccdabbaaddbbacaccbaaaacaccdabbaaddbbacacadddccbaaaacaccdabbaaddbbacaaccdabbaaddbbacacc'
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

describe('collectEchoedExcerpts across fields, edge cases', () => {
  // The separator between fields is a code no character has: a reference that contains the
  // character U+0001 between two pieces must not let a match run from one field into the next.
  it('should not let a match cross a field even when the reference holds a control character', () => {
    const first = 'the quick brown fox ju'
    const second = 'mps over the lazy dog'
    const reference = `${first}\u0001${second}`

    expect(collectEchoedExcerpts([first, second], reference)).toEqual([first, second])
  })

  // The list of examined fields starts empty: a field is examined only because it fits.
  it('should find nothing when no field echoes a reference that holds arbitrary text', () => {
    expect(collectEchoedExcerpts(['no echo here at all'], 'Stryker was here, and more')).toEqual([])
  })

  it('should keep a field that exactly fills the window and cut nothing', () => {
    const exact = 'x'.repeat(MAX_ECHO_SCAN_LENGTH)

    expect(collectEchoedExcerpts(exact, 'unrelated reference text')).toEqual([])
    expect(inspectErrorChain(Object.assign(new Error(exact), { stack: '' })).withheld).toBe(false)
  })
})

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

  // A chain that makes its next link only when `cause` is read, and counts the reads: how many
  // links were read is the work done, and it cannot depend on how loaded the machine is.
  it('should read only the window of a chain that never ends', () => {
    let reads = 0
    const link = (): Error => {
      const error = new Error('link')
      error.stack = 'Error'
      Object.defineProperty(error, 'cause', {
        get: () => {
          reads += 1
          return link()
        }
      })
      return error
    }

    const window = inspectErrorChain(link())

    expect(window.withheld).toBe(true)
    expect(window.parts).toHaveLength(MAX_ERROR_CHAIN_LINKS * 2)
    expect(reads).toBeLessThanOrEqual(MAX_ERROR_CHAIN_LINKS)
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

describe('inspectErrorChain character window', () => {
  it('should keep only the window of a 50 MB message, and withhold', () => {
    const huge = new Error('1234567890'.repeat(5_000_000))
    huge.stack = 'Error'

    const window = inspectErrorChain(huge)
    const messages = collectErrorChainMessages(huge)

    // What was kept is the window and no more: nothing after the read can cost more than that.
    expect(window.withheld).toBe(true)
    expect(window.parts[0]).toHaveLength(MAX_ECHO_SCAN_LENGTH)
    expect(messages).toHaveLength(MAX_ECHO_SCAN_LENGTH)
  })

  it('should spend the window across the fields of a chain and cut the one that crosses it', () => {
    const first = new Error('a'.repeat(MAX_ECHO_SCAN_LENGTH - 10))
    first.stack = ''
    const second = new Error('b'.repeat(100), { cause: first })
    second.stack = ''

    const window = inspectErrorChain(second)

    expect(window.withheld).toBe(true)
    expect(window.parts.join('')).toHaveLength(MAX_ECHO_SCAN_LENGTH)
  })

  it('should read the message and the stack of a link once each', () => {
    let messageReads = 0
    let stackReads = 0
    const error = new Error('base')
    Object.defineProperty(error, 'message', {
      get: () => {
        messageReads += 1
        return 'counted message'
      }
    })
    Object.defineProperty(error, 'stack', {
      get: () => {
        stackReads += 1
        return 'counted stack'
      }
    })

    inspectErrorChain(error)

    expect(messageReads).toBe(1)
    expect(stackReads).toBe(1)
  })
})
