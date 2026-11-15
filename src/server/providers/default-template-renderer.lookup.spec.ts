/**
 * @fileoverview Holds `DefaultTemplateRenderer` to reading only the property a placeholder names,
 * and only when that property is an own enumerable one. Resolving one placeholder must not read the
 * rest of the data object, so its cost does not grow with the object and a getter on another key
 * never runs. The remaining renderer specs live in `default-template-renderer.spec.ts`.
 * @layer infrastructure
 */

import { DefaultTemplateRenderer } from './default-template-renderer'

/** A renderer whose one template shows `placeholder` in the subject. */
function rendererFor(placeholder: string, enableNestedPaths: boolean): DefaultTemplateRenderer {
  return new DefaultTemplateRenderer({
    templates: { 'probe::en': { subject: `[${placeholder}]`, html: '<p>x</p>' } },
    enableNestedPaths
  })
}

/** What the subject renders to for `data`. */
async function subjectFor(
  placeholder: string,
  data: Record<string, unknown>,
  enableNestedPaths: boolean
): Promise<string> {
  return (await rendererFor(placeholder, enableNestedPaths).render('probe', data, 'en')).subject
}

/** An object with `size` own keys, and a counter of how often its keys were enumerated. */
function enumerationCounter(size: number): {
  target: Record<string, unknown>
  count: () => number
} {
  const base: Record<string, unknown> = { name: 'Maria' }
  for (let index = 0; index < size; index += 1) {
    base[`key${String(index)}`] = index
  }
  let enumerations = 0
  const target = new Proxy(base, {
    ownKeys(object) {
      enumerations += 1
      return Reflect.ownKeys(object)
    }
  })
  return { target, count: () => enumerations }
}

describe('DefaultTemplateRenderer property lookup', () => {
  // One placeholder is one property read: the object is never enumerated to find it.
  it('should not enumerate the object a nested path walks through', async () => {
    const { target, count } = enumerationCounter(1000)

    const subject = await subjectFor('{{user.name}}', { user: target }, true)

    expect(subject).toBe('[Maria]')
    expect(count()).toBe(0)
  })

  it('should not enumerate the data object for a flat path', async () => {
    const { target, count } = enumerationCounter(1000)

    const subject = await subjectFor('{{name}}', target, false)

    expect(subject).toBe('[Maria]')
    expect(count()).toBe(0)
  })

  it('should not enumerate any level of a deep path', async () => {
    const levels = [enumerationCounter(50), enumerationCounter(50), enumerationCounter(50)]
    levels[0]!.target['next'] = levels[1]!.target
    levels[1]!.target['next'] = levels[2]!.target

    const subject = await subjectFor('{{a.next.next.name}}', { a: levels[0]!.target }, true)

    expect(subject).toBe('[Maria]')
    expect(levels.map((level) => level.count())).toEqual([0, 0, 0])
  })

  // A getter on a key the template never names does not run, so it cannot break the render.
  it.each([true, false])(
    'should not run a getter on a key the placeholder does not name (nested paths %p)',
    async (nested) => {
      const data = { name: 'Maria' }
      Object.defineProperty(data, 'boom', {
        enumerable: true,
        get: () => {
          throw new Error('unrelated getter ran')
        }
      })
      const placeholder = nested ? '{{user.name}}' : '{{name}}'

      const subject = await subjectFor(placeholder, nested ? { user: data } : data, nested)

      expect(subject).toBe('[Maria]')
    }
  )

  // The getter of the key that IS named runs, once per placeholder.
  it('should run the getter of the named key once', async () => {
    let reads = 0
    const data = {}
    Object.defineProperty(data, 'name', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'Maria'
      }
    })

    const subject = await subjectFor('{{user.name}}', { user: data }, true)

    expect(subject).toBe('[Maria]')
    expect(reads).toBe(1)
  })

  // The keys that resolve are the own enumerable string keys.
  describe('which keys resolve', () => {
    it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'])(
      'should not resolve the inherited key %s',
      async (key) => {
        expect(await subjectFor(`{{${key}}}`, {}, false)).toBe('[]')
        expect(await subjectFor(`{{user.${key}}}`, { user: {} }, true)).toBe('[]')
      }
    )

    it('should not resolve a non-enumerable own key', async () => {
      const data = {}
      Object.defineProperty(data, 'hidden', { enumerable: false, value: 'secret' })

      expect(await subjectFor('{{hidden}}', data, false)).toBe('[]')
      expect(await subjectFor('{{user.hidden}}', { user: data }, true)).toBe('[]')
    })

    it('should not resolve the length of an array', async () => {
      expect(await subjectFor('{{items.length}}', { items: ['a', 'b'] }, true)).toBe('[]')
    })

    it('should resolve an index of an array', async () => {
      expect(await subjectFor('{{items.1}}', { items: ['a', 'b'] }, true)).toBe('[b]')
    })

    it('should resolve an own __proto__ key that holds data', async () => {
      const data = JSON.parse('{"__proto__": "own"}') as Record<string, unknown>

      expect(await subjectFor('{{__proto__}}', data, false)).toBe('[own]')
      expect(await subjectFor('{{user.__proto__}}', { user: data }, true)).toBe('[own]')
    })

    it('should resolve a flat key that contains a dot', async () => {
      expect(await subjectFor('{{user.name}}', { 'user.name': 'Maria' }, false)).toBe('[Maria]')
    })

    // The own-and-enumerable test is called through Object.prototype, so it must not need the data
    // object to have a prototype of its own.
    it('should resolve an own key of an object with no prototype', async () => {
      const data = Object.assign(Object.create(null) as Record<string, unknown>, { name: 'Maria' })

      expect(await subjectFor('{{name}}', data, false)).toBe('[Maria]')
      expect(await subjectFor('{{user.name}}', { user: data }, true)).toBe('[Maria]')
    })

    it('should not resolve an inherited key of an object with no prototype', async () => {
      const data = Object.create(null) as Record<string, unknown>

      expect(await subjectFor('{{toString}}', data, false)).toBe('[]')
      expect(await subjectFor('{{user.toString}}', { user: data }, true)).toBe('[]')
    })

    // A key a proxy reports as enumerable whose value cannot be read fails the render with the error
    // the proxy itself raised: nothing in the renderer wraps it, replaces it or adds to it.
    it.each([true, false])(
      'should fail with the proxy own error when reading an enumerable key throws (nested paths %p)',
      async (nested) => {
        const failure = new Error('the trap failed')
        const proxy = new Proxy(
          { name: 'Maria' },
          {
            getOwnPropertyDescriptor: (target, key) =>
              Reflect.getOwnPropertyDescriptor(target, key),
            get: () => {
              throw failure
            }
          }
        )
        const placeholder = nested ? '{{user.name}}' : '{{name}}'

        const outcome: unknown = await subjectFor(
          placeholder,
          nested ? { user: proxy } : (proxy as Record<string, unknown>),
          nested
        ).catch((error: unknown) => error)

        expect(outcome).toBe(failure)
      }
    )

    it('should resolve an own key of a class instance', async () => {
      class Person {
        name = 'Maria'
      }

      expect(await subjectFor('{{user.name}}', { user: new Person() }, true)).toBe('[Maria]')
    })

    it('should not resolve a method on the prototype of a class instance', async () => {
      class Person {
        greet(): string {
          return 'hi'
        }
      }

      expect(await subjectFor('{{user.greet}}', { user: new Person() }, true)).toBe('[]')
    })
  })
})
