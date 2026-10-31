/**
 * @fileoverview Holds the README's `DefaultTemplateRenderer` option table to the renderer's
 * behaviour: the documented default of each option is what a renderer built without it does.
 * @layer infrastructure
 */
import { readmeTable, unquote } from '../config/__tests__/readme-tables'

import { DefaultTemplateRenderer } from './default-template-renderer'

const rows = new Map(
  readmeTable(['Renderer option', 'Default', 'Notes']).map(([option = '', fallback = '']) => [
    unquote(option),
    unquote(fallback)
  ])
)

const hello = { subject: 'S', html: '<p>Hi {{user.name}}</p>' }

describe('README renderer option table', () => {
  // A table that parses to nothing would let every case below pass vacuously.
  it('should list the four renderer options', () => {
    expect([...rows.keys()]).toEqual([
      'templates',
      'fallbackLocales',
      'onMissingVar',
      'enableNestedPaths'
    ])
  })

  // No templates are registered unless the caller registers them.
  it('should document an empty template registry', async () => {
    const renderer = new DefaultTemplateRenderer()

    expect(rows.get('templates')).toBe('{}')
    expect(await renderer.hasTemplate('welcome', 'en')).toBe(false)
  })

  // The fallback chain is the English locale: a template registered for `en` answers `pt`.
  it('should document the English fallback locale', async () => {
    const renderer = new DefaultTemplateRenderer({ templates: { 'welcome::en': hello } })

    expect(rows.get('fallbackLocales')).toBe("['en']")
    await expect(renderer.render('welcome', { 'user.name': 'Jane' }, 'pt')).resolves.toMatchObject({
      subject: 'S'
    })
  })

  // A missing variable renders as an empty string by default and raises under 'throw'.
  it('should document that a missing variable renders empty by default', async () => {
    const renderer = new DefaultTemplateRenderer({ templates: { 'welcome::en': hello } })
    const strict = new DefaultTemplateRenderer({
      templates: { 'welcome::en': hello },
      onMissingVar: 'throw'
    })

    expect(rows.get('onMissingVar')).toBe("'empty'")
    expect((await renderer.render('welcome', {}, 'en')).html).toBe('<p>Hi </p>')
    await expect(strict.render('welcome', {}, 'en')).rejects.toThrow()
  })

  // A dotted path is a literal key unless nested paths are enabled.
  it('should document that nested paths are off by default', async () => {
    const data = { user: { name: 'Jane' }, 'user.name': 'Literal' }
    const flat = new DefaultTemplateRenderer({ templates: { 'welcome::en': hello } })
    const nested = new DefaultTemplateRenderer({
      templates: { 'welcome::en': hello },
      enableNestedPaths: true
    })

    expect(rows.get('enableNestedPaths')).toBe('false')
    expect((await flat.render('welcome', data, 'en')).html).toBe('<p>Hi Literal</p>')
    expect((await nested.render('welcome', data, 'en')).html).toBe('<p>Hi Jane</p>')
  })
})
