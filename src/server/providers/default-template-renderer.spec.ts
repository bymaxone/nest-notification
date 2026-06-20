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
  // string rather than literal "undefined".
  it('should render a missing variable as an empty string', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('otp_code', {}, 'en')

    expect(rendered.subject).toBe('Code for ')
    expect(rendered.html).toBe('<p>Hi , your code is </p>')
  })

  // A template without a text body must omit `text` from the rendered output.
  it('should omit text when the template has none', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('welcome', {}, 'en')

    expect(rendered.subject).toBe('Welcome')
    expect(rendered.text).toBeUndefined()
  })

  // Locale fallback: an unregistered locale falls back to the `en` template.
  it('should fall back to the en template when the locale is missing', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    const rendered = await renderer.render('welcome', {}, 'pt-BR')

    expect(rendered.subject).toBe('Welcome')
  })

  // A truly missing template throws with the template name for debuggability.
  it('should throw with the template name when not found', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    await expect(renderer.render('missing', {}, 'en')).rejects.toThrow(
      'Template not found: missing (locale=en)'
    )
  })

  // hasTemplate reflects registry membership for the exact name + locale.
  it('should report hasTemplate correctly', async () => {
    const renderer = new DefaultTemplateRenderer({ templates })

    await expect(renderer.hasTemplate('otp_code', 'en')).resolves.toBe(true)
    await expect(renderer.hasTemplate('otp_code', 'fr')).resolves.toBe(false)
  })
})
