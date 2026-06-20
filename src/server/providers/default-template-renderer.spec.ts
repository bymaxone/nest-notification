import { DefaultTemplateRenderer } from './default-template-renderer'

const templates = {
  'otp_code::en': {
    subject: 'Code for {{name}}',
    html: '<p>Hi {{name}}, your code is {{code}}</p>',
    text: 'Hi {{name}}, your code is {{code}}'
  },
  'welcome::en': { subject: 'Welcome', html: '<p>Welcome</p>' }
}

describe('DefaultTemplateRenderer', () => {
  // Identity contract: the renderer names itself for audit/logging.
  it('should report name "default-interpolation"', () => {
    expect(new DefaultTemplateRenderer().name).toBe('default-interpolation')
  })

  // Plain interpolation: variables are substituted in subject, html, and text.
  it('should interpolate variables into subject, html, and text', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('otp_code', { name: 'Jane', code: '123456' }, 'en')

    expect(rendered.subject).toBe('Code for Jane')
    expect(rendered.html).toBe('<p>Hi Jane, your code is 123456</p>')
    expect(rendered.text).toBe('Hi Jane, your code is 123456')
  })

  // XSS gate: a value containing markup must be escaped in the html body only —
  // the subject and text bodies are not HTML contexts and stay raw.
  it('should escape interpolated values in the html body only', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('otp_code', { name: '<script>', code: '1&2"3\'' }, 'en')

    expect(rendered.html).toContain('Hi &lt;script&gt;,')
    expect(rendered.html).toContain('1&amp;2&quot;3&#39;')
    expect(rendered.subject).toBe('Code for <script>')
    expect(rendered.text).toContain('1&2"3\'')
  })

  // A placeholder whose variable is absent from the data renders as an empty
  // string rather than literal "undefined" (default onMissingVar: 'empty').
  it('should render a missing variable as an empty string by default', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('otp_code', {}, 'en')

    expect(rendered.subject).toBe('Code for ')
    expect(rendered.html).toBe('<p>Hi , your code is </p>')
  })

  // A null value is treated as missing and renders as an empty string.
  it('should treat a null value as missing', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('otp_code', { name: null, code: '1' }, 'en')

    expect(rendered.subject).toBe('Code for ')
  })

  // onMissingVar 'throw' surfaces the offending variable name (fail fast).
  it('should throw with the variable name when onMissingVar is "throw"', async () => {
    const renderer = new DefaultTemplateRenderer({ templates, onMissingVar: 'throw' })

    await expect(renderer.render('otp_code', { name: 'Jane' }, 'en')).rejects.toThrow(
      'Missing template variable: code'
    )
  })

  // A template without a text body must omit `text` from the rendered output.
  it('should omit text when the template has none', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('welcome', {}, 'en')

    expect(rendered.subject).toBe('Welcome')
    expect(rendered.text).toBeUndefined()
  })

  // Fallback chain: tries [locale, ...fallbackLocales] in order, first match wins.
  it('should resolve along the fallback chain in order', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: {
        'otp_code::pt': { subject: 'Código', html: '<p>pt</p>' },
        'otp_code::en': { subject: 'Code', html: '<p>en</p>' }
      },
      fallbackLocales: ['pt', 'en']
    })

    const rendered = await renderer.render('otp_code', {}, 'pt-BR')

    expect(rendered.subject).toBe('Código')
  })

  // Fallback chain skips the requested locale when it also appears in the list
  // (no duplicate lookups) and lands on the next available template.
  it('should fall through to a later fallback locale without duplicating', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: { 'welcome::en': { subject: 'Welcome', html: '<p>en</p>' } },
      fallbackLocales: ['en']
    })

    const rendered = await renderer.render('welcome', {}, 'en')

    expect(rendered.subject).toBe('Welcome')
  })

  // A truly missing template throws with the name, locale, and tried chain.
  it('should throw with the template name and tried chain when not found', async () => {
    const renderer = new DefaultTemplateRenderer({ templates, fallbackLocales: ['en'] })

    await expect(renderer.render('missing', {}, 'fr')).rejects.toThrow(
      'Template not found: missing (locale=fr, tried=fr,en)'
    )
  })

  // hasTemplate reflects registry membership for the exact name + locale.
  it('should report hasTemplate correctly', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    await expect(renderer.hasTemplate('otp_code', 'en')).resolves.toBe(true)
    await expect(renderer.hasTemplate('otp_code', 'fr')).resolves.toBe(false)
  })

  // Nested paths: when enabled, {{user.name}} traverses the data object.
  it('should resolve nested paths when enableNestedPaths is true', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: { 'greet::en': { subject: 'Hi {{user.name}}', html: '<p>{{user.name}}</p>' } },
      enableNestedPaths: true
    })

    const rendered = await renderer.render('greet', { user: { name: 'Maria' } }, 'en')

    expect(rendered.subject).toBe('Hi Maria')
    expect(rendered.html).toBe('<p>Maria</p>')
  })

  // Nested paths off (default): a dotted placeholder is treated as a flat key,
  // which is absent from the data and therefore renders empty.
  it('should treat a dotted placeholder as a flat key by default', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: { 'greet::en': { subject: 'Hi {{user.name}}', html: '<p>x</p>' } }
    })

    const rendered = await renderer.render('greet', { user: { name: 'Maria' } }, 'en')

    expect(rendered.subject).toBe('Hi ')
  })

  // Nested path that traverses a null intermediate yields empty, never an error.
  it('should return empty when a nested path traverses null', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: { 'greet::en': { subject: 'Hi {{user.name}}', html: '<p>x</p>' } },
      enableNestedPaths: true
    })

    const rendered = await renderer.render('greet', { user: null }, 'en')

    expect(rendered.subject).toBe('Hi ')
  })

  // Nested path whose intermediate key is absent (undefined) also yields empty.
  it('should return empty when a nested path traverses an absent key', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: { 'greet::en': { subject: 'Hi {{a.b.c}}', html: '<p>x</p>' } },
      enableNestedPaths: true
    })

    const rendered = await renderer.render('greet', { a: {} }, 'en')

    expect(rendered.subject).toBe('Hi ')
  })

  // Nested path that descends into a non-object (primitive) yields empty.
  it('should return empty when a nested path descends into a primitive', async () => {
    const renderer = new DefaultTemplateRenderer({
      templates: { 'greet::en': { subject: 'Hi {{a.b}}', html: '<p>x</p>' } },
      enableNestedPaths: true
    })

    const rendered = await renderer.render('greet', { a: 'str' }, 'en')

    expect(rendered.subject).toBe('Hi ')
  })

  // Construction validation: a null template value fails fast.
  it('should reject a null template at construction', () => {
    expect(
      () => new DefaultTemplateRenderer({ templates: { 'x::en': null as never } })
    ).toThrow('Invalid template "x::en" — must have { subject: string, html: string }')
  })

  // Construction validation: a non-object template value fails fast.
  it('should reject a non-object template at construction', () => {
    expect(
      () => new DefaultTemplateRenderer({ templates: { 'x::en': 'nope' as never } })
    ).toThrow('Invalid template "x::en"')
  })

  // Construction validation: a template missing `subject` fails fast.
  it('should reject a template without a string subject at construction', () => {
    expect(
      () => new DefaultTemplateRenderer({ templates: { 'x::en': { html: '<p>x</p>' } as never } })
    ).toThrow('Invalid template "x::en"')
  })

  // Construction validation: a template missing `html` fails fast.
  it('should reject a template without a string html at construction', () => {
    expect(
      () => new DefaultTemplateRenderer({ templates: { 'x::en': { subject: 'S' } as never } })
    ).toThrow('Invalid template "x::en"')
  })
})
