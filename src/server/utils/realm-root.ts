/**
 * @fileoverview Refuses to connect or send while this realm's `Object.prototype` holds a string key
 * outside the runtime's standard set, or a standard key that is no longer what it was at load.
 * @layer infrastructure
 *
 * A key planted on the root answers for every name a transport or an SDK reads from an object the
 * library does not build (an instance of its own, an option Node validates, an object copied into an
 * ordinary one). Naming the keys that are read is a list that grows with every release of a
 * dependency; the standard set is fixed, so the check is an allowlist: any other string key is
 * refused, before any I/O. A standard name can also be overwritten (`hasOwnProperty = 1`, or a JSON
 * payload that sets `constructor`), which no allowlist by name sees, so each standard key's
 * descriptor is kept at load and a descriptor that differs counts like a planted key. A standard key
 * that was not what it must be at load (the realm was polluted before the library loaded) counts on
 * every use; loading itself never throws. The built-ins the options and the send paths call are
 * compared with the ones that were there at load, by identity, so a replacement made after the import
 * refuses too. The refusal
 * reports a count and never a key or a value, because a key can carry a secret and a value can be
 * the text an attacker wants logged.
 */

import { types } from 'node:util'

import { refuseInput } from './bounded-list'
import { HASH_PROTOTYPE, HMAC_PROTOTYPE } from './captured-crypto'

// Captured when the module loads, so a host that replaces a built-in later cannot change the answer.
// Everything the check calls after the load is in this block: a built-in that is looked up when the
// check runs (`Array.prototype.filter`, `Set.prototype.has`, `Reflect.get`, a `for...of`, a spread)
// can be replaced by code that ran after this module was imported, and a check that asks a
// replacement whether the root is clean is told what the replacement says.
const ROOT = Object.prototype
const namesOf = Object.getOwnPropertyNames
const symbolsOf = Object.getOwnPropertySymbols
const descriptorOf = Object.getOwnPropertyDescriptor
const same = Object.is
const hasOwn = Object.hasOwn
// The one symbol key a host's own tooling puts on the root: jest keeps it there, not enumerable, to
// protect the prototype from deletion. It is that registered symbol, only while it is not enumerable.
const JEST_PROTECT = Symbol.for('$$jest-protect-from-deletion')
const reflectGet = Reflect.get
const isProxy = types.isProxy
// `uncurry(fn)` is `fn` called with its receiver as the first argument, whatever `fn.call` is later.
const uncurry = Function.prototype.bind.bind(Function.prototype.call) as <A extends unknown[], R>(
  fn: (...args: A) => R
) => (receiver: unknown, ...args: A) => R
const setHas = uncurry(Set.prototype.has) as (set: ReadonlySet<string>, name: string) => boolean
const sourceOf = uncurry(Function.prototype.toString) as (fn: unknown) => string
const endsWith = uncurry(String.prototype.endsWith) as (text: string, tail: string) => boolean
const nth = uncurry(Array.prototype.at) as <T>(list: ArrayLike<T>, index: number) => T | undefined

/**
 * The string keys `Object.prototype` has in every runtime this library supports. A spec compares
 * it with the runtime it runs on, so a runtime that adds a key fails the build and not a send.
 */
export const STANDARD_ROOT_KEYS: ReadonlySet<string> = new Set(
  '__defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ __proto__ constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf'.split(
    ' '
  )
)

/** The fields of a property descriptor, in the order they are kept. */
const DESCRIPTOR_FIELDS = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'] as const

/** The positions of the flags that freezing the root turns off, in {@link DESCRIPTOR_FIELDS}. */
const WRITABLE = 3
const CONFIGURABLE = 5

/** The standard keys as a list, so the check walks them by index. */
const KEYS: readonly string[] = [...STANDARD_ROOT_KEYS]

/**
 * A descriptor's field, `undefined` when the descriptor does not own it. A descriptor is an ordinary
 * object, so a name read from it that it does not own reaches `Object.prototype`: a planted accessor
 * called `get` would run during the comparison.
 *
 * @param descriptor - A property descriptor.
 * @param field - One of {@link DESCRIPTOR_FIELDS}.
 * @returns The field, or `undefined`.
 */
function readField(descriptor: PropertyDescriptor, field: string): unknown {
  return hasOwn(descriptor, field) ? reflectGet(descriptor, field) : undefined
}

/**
 * A key's descriptor as a list of its fields, in the order of {@link DESCRIPTOR_FIELDS}; `undefined`
 * for a key that is not there. Called while the module loads.
 *
 * @param name - A standard key.
 * @returns The fields, or `undefined`.
 */
function fieldsOf(name: string): unknown[] | undefined {
  const descriptor = descriptorOf(ROOT, name)
  return descriptor === undefined
    ? undefined
    : DESCRIPTOR_FIELDS.map((field) => readField(descriptor, field))
}

/** Each standard key as it was when the module loaded, in the order of {@link KEYS}. */
const LOADED: ReadonlyArray<unknown[] | undefined> = KEYS.map((name) => fieldsOf(name))

/**
 * What each standard key must be for the snapshot to mean anything: a native function with this name
 * (the `constructor` is `Object`), and `__proto__` an accessor of native functions. A key that is not,
 * at load, means the realm was polluted before the library was loaded, so no later comparison can tell.
 */
const EXPECTED_NAME: ReadonlyMap<string, string> = new Map(
  KEYS.map((name) => [name, name === 'constructor' ? 'Object' : name] as const)
)

/**
 * Whether a value is a function the engine implements, by its source: a replacement written in
 * JavaScript that carries the same name does not read `[native code]`, and a Proxy, which does,
 * is refused as a Proxy. Called while the module loads.
 *
 * @param value - What a standard key held.
 * @returns `true` for a native function.
 */
function isNative(value: unknown): boolean {
  return (
    typeof value === 'function' && !isProxy(value) && endsWith(sourceOf(value), '{ [native code] }')
  )
}

/**
 * Whether a standard key held the expected kind of value when the module loaded.
 *
 * @param index - The position of a standard key in {@link KEYS}.
 * @returns `true` when it did not.
 */
function wrongAtLoad(index: number): boolean {
  const name = nth(KEYS, index) as string
  const loaded = nth(LOADED, index)
  if (loaded === undefined) {
    // `node --disable-proto=delete` removes `__proto__`: a runtime without it is a standard one.
    return name !== '__proto__'
  }
  const [value, getter, setter] = loaded
  if (name === '__proto__') {
    return !isNative(getter) || !isNative(setter)
  }
  return !isNative(value) || (value as { name: string }).name !== EXPECTED_NAME.get(name)
}

/** How many standard keys were not what they must be at load; counted on every use, never thrown. */
const POLLUTED_AT_LOAD = KEYS.filter((_name, index) => wrongAtLoad(index)).length

/** The members of the intrinsics that hold the next-methods of the iterators of arrays, strings, sets and maps. */
const ARRAY_ITERATOR = Object.getPrototypeOf([][Symbol.iterator]()) as object
const STRING_ITERATOR = Object.getPrototypeOf(''[Symbol.iterator]()) as object
const SET_ITERATOR = Object.getPrototypeOf(new Set()[Symbol.iterator]()) as object
const MAP_ITERATOR = Object.getPrototypeOf(new Map()[Symbol.iterator]()) as object

/**
 * The built-ins the options and the send paths call, by the object that holds them and their names.
 * A host that replaced one of them after this module was imported leaves the library calling the
 * replacement, whatever the library captured: the check refuses while one is not the one that was
 * there at load. The global bindings are held too (`Object`, `Reflect`, `Array`, `Math`...).
 */
const BASELINE: ReadonlyArray<readonly [object, readonly PropertyKey[]]> = [
  [
    globalThis,
    [
      'Object',
      'Reflect',
      'Array',
      'Math',
      'Number',
      'String',
      'RegExp',
      'Set',
      'Map',
      'Symbol',
      'Promise'
    ]
  ],
  [
    Object,
    [
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
    ]
  ],
  [
    Reflect,
    ['apply', 'defineProperty', 'deleteProperty', 'get', 'getPrototypeOf', 'has', 'ownKeys', 'set']
  ],
  [Array, ['from', 'isArray']],
  [Math, ['ceil', 'floor', 'max', 'min']],
  [Number, ['isFinite', 'isInteger', 'isSafeInteger', 'parseInt']],
  [String, ['fromCodePoint']],
  [
    Array.prototype,
    [
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
      Symbol.iterator
    ]
  ],
  [ARRAY_ITERATOR, ['next']],
  [STRING_ITERATOR, ['next']],
  [SET_ITERATOR, ['next']],
  [MAP_ITERATOR, ['next']],
  [
    String.prototype,
    [
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
      Symbol.iterator
    ]
  ],
  [
    RegExp.prototype,
    [
      'exec',
      'test',
      Symbol.match,
      Symbol.matchAll,
      Symbol.replace,
      Symbol.search,
      Symbol.split,
      // The flag accessors a `replace` or a `split` reads.
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
    ]
  ],
  [Set.prototype, ['add', 'clear', 'delete', 'forEach', 'has', 'size', 'values', Symbol.iterator]],
  [
    Map.prototype,
    [
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
      Symbol.iterator
    ]
  ],
  // An `await` reads the `constructor` of what it awaits and calls its `then` when that is not %Promise%.
  [Promise.prototype, ['constructor', 'then']],
  [Date.prototype, [Symbol.toPrimitive]],
  // `crypto.randomInt` reads its random bytes with it, so a replaced one decides the code.
  [Buffer.prototype, ['readUIntBE']],
  // The methods of the hash objects decide every storage key and every stored digest.
  [HASH_PROTOTYPE, ['update', 'digest']],
  [HMAC_PROTOTYPE, ['update', 'digest']],
  [Buffer, ['byteLength', 'from']],
  [Symbol, ['for']],
  [Function.prototype, ['apply', 'bind', 'call', 'toString']]
]

/**
 * The field of a member's descriptor that stands for it: `value`, or `get` for an accessor (a flag of
 * a regular expression, the `size` of a collection). Called while the module loads, so it asks the
 * descriptor what it owns: a name planted on `Object.prototype` before the import must not reach it.
 *
 * @param descriptor - The descriptor of a member.
 * @returns `value` for a data property, `get` for an accessor.
 */
function fieldOf(descriptor: PropertyDescriptor): string {
  return hasOwn(descriptor, 'value') ? 'value' : 'get'
}

/**
 * What stands for a member: its value, or its getter when it is an accessor.
 *
 * @param holder - The object that holds the member.
 * @param name - The member's name, one the holder has.
 * @returns The value or the getter.
 */
function memberOf(holder: object, name: PropertyKey): unknown {
  const descriptor = descriptorOf(holder, name) as PropertyDescriptor
  return readField(descriptor, fieldOf(descriptor))
}

/** Each member of {@link BASELINE} that was there at load, as its holder and its name. */
export const BASELINE_MEMBERS: ReadonlyArray<readonly [object, PropertyKey]> = BASELINE.flatMap(
  ([holder, names]) =>
    names
      .filter((name) => hasOwn(holder, name) && memberOf(holder, name) !== undefined)
      .map((name) => [holder, name] as const)
)

const MEMBER_HOLDERS: readonly object[] = BASELINE_MEMBERS.map(([holder]) => holder)
const MEMBER_NAMES: readonly PropertyKey[] = BASELINE_MEMBERS.map(([, name]) => name)
const MEMBER_VALUES: readonly unknown[] = BASELINE_MEMBERS.map(([holder, name]) =>
  memberOf(holder, name)
)
/** Which field of the descriptor holds each member: `value`, or `get` for an accessor. */
const MEMBER_FIELDS: readonly string[] = BASELINE_MEMBERS.map(([holder, name]) =>
  fieldOf(descriptorOf(holder, name) as PropertyDescriptor)
)
const MEMBER_COUNT = MEMBER_HOLDERS.length

/**
 * How many members of {@link BASELINE} are not the ones that were there at load. It walks by index and
 * reads the holder's own data property, so a getter planted in place of a member does not run.
 *
 * @returns The number of replaced members.
 */
function replacedBuiltins(): number {
  let replaced = 0
  for (let index = 0; index < MEMBER_COUNT; index += 1) {
    const descriptor = descriptorOf(
      nth(MEMBER_HOLDERS, index) as object,
      nth(MEMBER_NAMES, index) as PropertyKey
    )
    const now =
      descriptor === undefined
        ? undefined
        : readField(descriptor, nth(MEMBER_FIELDS, index) as string)
    if (!same(now, nth(MEMBER_VALUES, index))) {
      replaced += 1
    }
  }
  return replaced
}

/**
 * Whether a standard key is what it was at load: present with the same value or accessors and the
 * same flags, or absent as it was. It walks by index and reads only what was captured at load.
 *
 * @param index - The position of a standard key in {@link KEYS}.
 * @returns `true` when its descriptor differs from the one kept at load.
 */
function changed(index: number): boolean {
  const before = nth(LOADED, index)
  const now = descriptorOf(ROOT, nth(KEYS, index) as string)
  if (before === undefined || now === undefined) {
    return (before === undefined) !== (now === undefined)
  }
  for (let field = 0; nth(DESCRIPTOR_FIELDS, field) !== undefined; field += 1) {
    const was = nth(before, field)
    const is = readField(now, nth(DESCRIPTOR_FIELDS, field) as string)
    // A key that only became non-writable or non-configurable, with the same value or accessors, is a
    // root that was hardened (`Object.freeze(Object.prototype)`), and not one that was polluted. A flag
    // that was on and differs is off, or the key is an accessor now and its accessors differ.
    const hardened = (field === WRITABLE || field === CONFIGURABLE) && was === true
    if (!same(was, is) && !hardened) {
      return true
    }
  }
  return false
}

/** The prototypes that must never own a `then`: it would answer for every array or function resolved. */
const THEN_FREE: readonly object[] = [Array.prototype, Function.prototype]

/**
 * How many of {@link THEN_FREE} own a `then`. `Object.prototype` is covered by the key check.
 *
 * @returns The count.
 */
function plantedThens(): number {
  let planted = 0
  for (let index = 0; index < THEN_FREE.length; index += 1) {
    if (hasOwn(nth(THEN_FREE, index) as object, 'then')) {
      planted += 1
    }
  }
  return planted
}

/**
 * Whether a symbol key of the root is the one jest puts there: that registered symbol, not enumerable.
 *
 * @param symbol - A symbol key of the root.
 * @returns `true` for the exempt key.
 */
function isProtection(symbol: symbol): boolean {
  const descriptor = same(symbol, JEST_PROTECT) ? descriptorOf(ROOT, symbol) : undefined
  return descriptor !== undefined && readField(descriptor, 'enumerable') === false
}

/**
 * Refuses while the realm root holds a string key that is not standard, or a standard key that
 * was overwritten, redefined or removed. Everything it calls is a reference taken when the module
 * loaded, and it walks with index loops, so a built-in replaced after the import cannot blind it.
 *
 * @param owner - The component that is about to connect or send, for the refusal.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER`, naming the count and nothing else.
 */
export function assertStandardRealmRoot(owner: string): void {
  const names = namesOf(ROOT)
  let count = POLLUTED_AT_LOAD + replacedBuiltins() + plantedThens()
  for (let at = 0; at < names.length; at += 1) {
    if (!setHas(STANDARD_ROOT_KEYS, nth(names, at) as string)) {
      count += 1
    }
  }
  for (let index = 0; nth(KEYS, index) !== undefined; index += 1) {
    if (changed(index)) {
      count += 1
    }
  }
  const symbols = symbolsOf(ROOT)
  for (let at = 0; at < symbols.length; at += 1) {
    if (!isProtection(nth(symbols, at) as symbol)) {
      count += 1
    }
  }
  if (count > 0) {
    throw refuseInput(
      owner,
      'Object.prototype',
      `holds ${count} key(s) or built-in(s) that are not the standard ones, so the operation is refused`
    )
  }
}

const intrinsicThen = uncurry(Promise.prototype.then) as (
  promise: Promise<unknown>,
  onFulfilled: () => void,
  onRejected: () => void
) => unknown
const noop = (): void => undefined
const defineOwn = Object.defineProperty
const INTRINSIC_PROMISE = Promise.prototype.constructor
const createBare = Object.create

/** The descriptor of an own `constructor` holding `value`, with no prototype to inherit from. */
function ownConstructor(value: unknown): PropertyDescriptor {
  const descriptor = createBare(null) as {
    value: unknown
    configurable: boolean
    writable: boolean
  }
  descriptor.value = value
  descriptor.configurable = true
  descriptor.writable = true
  return descriptor
}

/**
 * Gives a promise the library made an own `constructor`, so awaiting it takes the native path: no
 * `constructor` read off the realm, no `then` called, whatever was planted on `Promise.prototype`.
 *
 * @param promise - A promise the library itself made.
 * @returns The same promise.
 */
export function own<T>(promise: Promise<T>): Promise<T> {
  try {
    defineOwn(promise, 'constructor', ownConstructor(INTRINSIC_PROMISE))
  } catch {
    // A realm that refuses even this is refused by the check that follows.
  }
  return promise
}

/**
 * Attaches a handler that does nothing to a promise, with the `then` captured at load, so a promise
 * the caller will not await never ends as an unhandled rejection. Never throws.
 *
 * @param promise - Whatever a call returned; anything that is not a promise is left alone.
 */
export function silence(promise: unknown): void {
  try {
    if (types.isPromise(promise)) {
      // `then` reads `constructor` of the promise it is called on: an own one answers for it, so a
      // `constructor` planted or made to throw on `Promise.prototype` cannot decide whether the
      // handler is attached. It is `undefined`, not %Promise%: that makes the species lookup skip
      // `Promise[Symbol.species]`, a getter the realm could make throw.
      defineOwn(promise, 'constructor', ownConstructor(undefined))
      intrinsicThen(promise, noop, noop)
    }
  } catch {
    // A realm that refuses even this is already refused by the check that called it.
  }
}

/**
 * Checks the realm and hands back the promise the caller awaits on the very next token: a host's
 * promise is never awaited on a realm whose promises the call that made it replaced.
 *
 * @param pending - A promise a host call returned.
 * @param owner - The boundary named in the refusal.
 * @returns `pending`, unchanged.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when the realm was changed; `pending` is
 * then given a handler, since nobody will await it.
 */
export function checkedAwait<T>(pending: Promise<T>, owner: string): Promise<T> {
  try {
    assertStandardRealmRoot(owner)
  } catch (refusal) {
    silence(pending)
    throw refusal
  }
  return pending
}
