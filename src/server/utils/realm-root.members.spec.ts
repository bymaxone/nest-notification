/**
 * @fileoverview Holds the load baseline to the list of built-ins it is meant to hold, member by member.
 * The rows that replace each member walk the baseline itself, so a member dropped from it drops its own
 * row too; this list is written out separately, and a member that is missing, renamed or added shows here.
 * @layer infrastructure
 */

import { HASH_PROTOTYPE, HMAC_PROTOTYPE } from './captured-crypto'
import { BASELINE_MEMBERS } from './realm-root'

const ITERATORS = {
  array: Object.getPrototypeOf([][Symbol.iterator]()) as object,
  string: Object.getPrototypeOf(''[Symbol.iterator]()) as object,
  set: Object.getPrototypeOf(new Set()[Symbol.iterator]()) as object,
  map: Object.getPrototypeOf(new Map()[Symbol.iterator]()) as object
}

/** The holders of the baseline, by the label the list below uses. */
const HOLDERS: ReadonlyArray<readonly [string, object]> = [
  ['globalThis', globalThis],
  ['Object', Object],
  ['Reflect', Reflect],
  ['Array', Array],
  ['Math', Math],
  ['Number', Number],
  ['String', String],
  ['Array.prototype', Array.prototype],
  ['ArrayIterator', ITERATORS.array],
  ['StringIterator', ITERATORS.string],
  ['SetIterator', ITERATORS.set],
  ['MapIterator', ITERATORS.map],
  ['String.prototype', String.prototype],
  ['RegExp.prototype', RegExp.prototype],
  ['Set.prototype', Set.prototype],
  ['Map.prototype', Map.prototype],
  ['Date.prototype', Date.prototype],
  ['Buffer.prototype', Buffer.prototype],
  ['Hash.prototype', HASH_PROTOTYPE],
  ['Hmac.prototype', HMAC_PROTOTYPE],
  ['Buffer', Buffer],
  ['Symbol', Symbol],
  ['Function.prototype', Function.prototype]
]

const named = (holder: string, names: readonly string[]): string[] =>
  names.map((name) => `${holder} ${name}`)

const ITERATOR = 'Symbol(Symbol.iterator)'

/** What the baseline holds. */
const EXPECTED: readonly string[] = [
  ...named('globalThis', [
    'Object',
    'Reflect',
    'Array',
    'Math',
    'Number',
    'String',
    'RegExp',
    'Set',
    'Map',
    'Symbol'
  ]),
  ...named('Object', [
    'assign',
    'create',
    'defineProperty',
    'entries',
    'freeze',
    'fromEntries',
    'getOwnPropertyDescriptor',
    'getOwnPropertyDescriptors',
    'getOwnPropertyNames',
    'getOwnPropertySymbols',
    'getPrototypeOf',
    'hasOwn',
    'is',
    'keys',
    'setPrototypeOf',
    'values'
  ]),
  ...named('Reflect', [
    'apply',
    'defineProperty',
    'deleteProperty',
    'get',
    'getPrototypeOf',
    'has',
    'ownKeys',
    'set'
  ]),
  ...named('Array', ['from', 'isArray']),
  ...named('Math', ['ceil', 'floor', 'max', 'min']),
  ...named('Number', ['isFinite', 'isInteger', 'isSafeInteger', 'parseInt']),
  ...named('String', ['fromCodePoint']),
  ...named('Array.prototype', [
    'at',
    'concat',
    'entries',
    'every',
    'filter',
    'find',
    'findIndex',
    'flat',
    'flatMap',
    'forEach',
    'includes',
    'indexOf',
    'join',
    'keys',
    'lastIndexOf',
    'map',
    'pop',
    'push',
    'reduce',
    'reverse',
    'slice',
    'some',
    'sort',
    'splice',
    'values',
    ITERATOR
  ]),
  ...named('ArrayIterator', ['next']),
  ...named('StringIterator', ['next']),
  ...named('SetIterator', ['next']),
  ...named('MapIterator', ['next']),
  ...named('String.prototype', [
    'at',
    'charAt',
    'charCodeAt',
    'codePointAt',
    'endsWith',
    'includes',
    'indexOf',
    'lastIndexOf',
    'localeCompare',
    'match',
    'matchAll',
    'normalize',
    'padStart',
    'repeat',
    'replace',
    'replaceAll',
    'slice',
    'split',
    'startsWith',
    'substring',
    'toLowerCase',
    'toString',
    'toUpperCase',
    'trim',
    'trimEnd',
    'trimStart',
    ITERATOR
  ]),
  ...named('RegExp.prototype', [
    'exec',
    'test',
    'Symbol(Symbol.match)',
    'Symbol(Symbol.matchAll)',
    'Symbol(Symbol.replace)',
    'Symbol(Symbol.search)',
    'Symbol(Symbol.split)',
    'dotAll',
    'flags',
    'global',
    'hasIndices',
    'ignoreCase',
    'multiline',
    'source',
    'sticky',
    'unicode',
    'unicodeSets'
  ]),
  ...named('Set.prototype', [
    'add',
    'clear',
    'delete',
    'forEach',
    'has',
    'size',
    'values',
    ITERATOR
  ]),
  ...named('Map.prototype', [
    'clear',
    'delete',
    'entries',
    'forEach',
    'get',
    'has',
    'keys',
    'set',
    'size',
    'values',
    ITERATOR
  ]),
  ...named('Date.prototype', ['Symbol(Symbol.toPrimitive)']),
  ...named('Buffer.prototype', ['readUIntBE']),
  ...named('Hash.prototype', ['update', 'digest']),
  ...named('Hmac.prototype', ['update', 'digest']),
  ...named('Buffer', ['byteLength', 'from']),
  ...named('Symbol', ['for']),
  ...named('Function.prototype', ['apply', 'bind', 'call', 'toString'])
]

const holderLabel = (holder: object): string =>
  HOLDERS.find(([, candidate]) => candidate === holder)?.[0] ?? 'unknown holder'

describe('the members of the load baseline', () => {
  it('should be exactly the built-ins listed here, by holder and name', () => {
    const held = BASELINE_MEMBERS.map(([holder, name]) => `${holderLabel(holder)} ${String(name)}`)

    expect([...held].sort()).toStrictEqual([...EXPECTED].sort())
  })
})
