/**
 * @fileoverview Puts the masked recipient where an error's text carries the raw one.
 * @layer utils
 */

/** A character and the combining marks that follow it, or a run of marks with nothing before it. */
const CLUSTER = /\p{M}+|\P{M}\p{M}*/gu

/** A node of the tree of addresses: the code points that may follow, and the mask where one ends. */
interface Node {
  next: Map<string, Node>
  /** The address that ends here, as the caller wrote it. */
  address: string | undefined
  /** What the mask answered for it, once a match asked. */
  masked: string | undefined
}

/** A text in lower case, as code points, with where each one starts in the original text. */
interface Folded {
  points: string[]
  /** The index in the original text of the character each point came from; one more entry at the end. */
  origin: number[]
  /** Whether each point is the first one its character produced; one more entry at the end. */
  starts: boolean[]
}

/**
 * Folds a text one character with its combining marks at a time, keeping the code points of each
 * result and where its character began. A cluster is decomposed, which also puts its marks in the
 * canonical order (an accented letter and the letter followed by its accents are one, whatever the
 * order the accents were written in), taken to upper case and back, and the sharp s is written `ss`: the result is the
 * same for every case and every form a letter is written in and does not depend on the letters
 * around it, where a lower case alone does not (a capital sigma lowers to `\u03c3` and a final
 * sigma is `\u03c2`, and both come back as `\u03c3`). A character whose folded form is longer than itself (`İ` is `i` and a
 * combining dot) gives several points that share one origin, and only the first is a start, so a
 * match can begin and end only between characters of the original text.
 */
function fold(text: string): Folded {
  const points: string[] = []
  const origin: number[] = []
  const starts: boolean[] = []
  let index = 0
  for (const character of text.match(CLUSTER) ?? []) {
    Array.from(
      character.normalize('NFD').toUpperCase().toLowerCase().replaceAll('\u00df', 'ss')
    ).forEach((point, offset) => {
      points.push(point)
      origin.push(index)
      starts.push(offset === 0)
    })
    index += character.length
  }
  origin.push(text.length)
  starts.push(true)
  return { points, origin, starts }
}

/** The tree of the folded addresses, each ending at the mask the caller answers for it. */
function treeOf(addresses: readonly string[]): Node {
  const root: Node = { next: new Map(), address: undefined, masked: undefined }
  for (const address of addresses.filter((entry) => entry !== '')) {
    let node = root
    for (const point of fold(address).points) {
      const child = node.next.get(point) ?? {
        next: new Map<string, Node>(),
        address: undefined,
        masked: undefined
      }
      node.next.set(point, child)
      node = child
    }
    node.address ??= address
  }
  return root
}

/**
 * Replaces every occurrence of each address in `text`, ignoring letter case, with what the mask
 * answers for it. A relay quotes the address it refused (`550 <bob@x.com> unknown`), often in
 * another case than the caller wrote it, and the audit row that carries the text is where the mask
 * is promised.
 *
 * The addresses are one tree of lower-case code points, and the text is read once from the start:
 * at each character the longest address that begins there and ends between characters is the match.
 * A position walks no further than the longest address, so the cost follows the length of the text
 * and not the number of addresses, and the lower case of a text or of an address may have another
 * length than the original without a match being missed.
 *
 * @param text - The text an audit entry would carry.
 * @param addresses - The addresses of the message, from `to`, `cc` and `bcc`.
 * @param mask - `audit.maskRecipient`, asked once for each distinct address the text quotes.
 * @returns The text with every occurrence of every address replaced.
 */
export function maskRecipientsInText(
  text: string,
  addresses: readonly string[],
  mask: (recipient: string) => string
): string {
  const root = treeOf(addresses)
  const { points, origin, starts } = fold(text)
  let out = ''
  let from = 0
  let at = 0
  while (at < points.length) {
    let longest: { length: number; node: Node } | undefined
    let node: Node | undefined = starts.at(at) ? root : undefined
    for (let end = at; node !== undefined && end < points.length; end += 1) {
      node = node.next.get(String(points.at(end)))
      if (node?.address !== undefined && starts.at(end + 1)) {
        longest = { length: end + 1 - at, node }
      }
    }
    if (longest === undefined) {
      at += 1
    } else {
      longest.node.masked ??= mask(String(longest.node.address))
      out += text.slice(from, Number(origin.at(at))) + longest.node.masked
      at += longest.length
      from = Number(origin.at(at))
    }
  }
  return out + text.slice(from)
}
