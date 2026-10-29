# MJML `IEmailTemplateRenderer` adapter (reference example)

> **Reference only — copy and adapt to your project.** `@bymax-one/nest-notification`
> ships **no** MJML dependency and **no** markup. This file documents how to use
> [MJML](https://mjml.io/) for responsive layout while keeping variable interpolation
> safe.

Verified against `mjml@^5` — `mjml2html(markup, options)` is **async** and resolves to `{ html, errors }`.

## Setup

```bash
pnpm add mjml
```

## Implementation

MJML compiles **layout**, not data. It does **not** escape interpolated variables, so
this adapter splits the two concerns: it compiles each MJML body to responsive HTML
**once** in the constructor (placeholders such as `{{name}}` survive into the HTML),
then performs an **HTML-escaping** `{{var}}` substitution at render time. The subject
is plain text and is interpolated without escaping.

```typescript
import mjml2html from 'mjml'
import type { IEmailTemplateRenderer, RenderedEmail } from '@bymax-one/nest-notification'

interface RawTemplate {
  subject: string
  mjml: string
  text?: string
}

interface CompiledTemplate {
  subject: string
  html: string
  text?: string
}

const TEMPLATE_VAR = /\{\{\s*(\w+)\s*\}\}/g

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const fill = (source: string, data: Record<string, unknown>, escape: boolean): string =>
  source.replace(TEMPLATE_VAR, (_match, name: string) => {
    const raw = String(data[name] ?? '')
    return escape ? escapeHtml(raw) : raw
  })

/**
 * Renders email templates with MJML layout + escaped `{{var}}` interpolation.
 * Keys follow the library convention `${templateName}::${locale}`.
 */
export class MjmlTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'mjml'

  private constructor(private readonly compiled: ReadonlyMap<string, CompiledTemplate>) {}

  /** Compiles every template once, because `mjml2html` is async and a constructor cannot await. */
  static async create(templates: Record<string, RawTemplate>): Promise<MjmlTemplateRenderer> {
    const compiled = new Map<string, CompiledTemplate>()
    for (const [key, template] of Object.entries(templates)) {
      const { html, errors } = await mjml2html(template.mjml, { validationLevel: 'strict' })
      if (errors.length > 0) {
        throw new Error(`Invalid MJML for "${key}": ${errors[0]?.message}`)
      }
      compiled.set(key, {
        subject: template.subject,
        html,
        ...(template.text !== undefined ? { text: template.text } : {})
      })
    }
    return new MjmlTemplateRenderer(compiled)
  }

  async hasTemplate(templateName: string, locale: string): Promise<boolean> {
    return this.compiled.has(`${templateName}::${locale}`)
  }

  async render(
    templateName: string,
    data: Record<string, unknown>,
    locale: string
  ): Promise<RenderedEmail> {
    const template =
      this.compiled.get(`${templateName}::${locale}`) ?? this.compiled.get(`${templateName}::en`)
    if (!template) {
      throw new Error(`Template not found: ${templateName} (locale=${locale})`)
    }
    return {
      subject: fill(template.subject, data, false),
      html: fill(template.html, data, true),
      ...(template.text !== undefined ? { text: fill(template.text, data, false) } : {})
    }
  }
}
```

## Security caveats

- **MJML does not escape your variables.** It only transforms markup. If you inject
  user data into the MJML string (or the compiled HTML) without escaping, you have a
  stored-XSS vector. This adapter escapes during the post-compile `{{var}}` pass —
  keep that escaping if you adapt the code.
- **Escape the html body only.** The `subject`/`text` outputs are not HTML contexts;
  escaping them would surface literal `&amp;`/`&lt;`.
- **Compile once, render many.** `mjml2html` is comparatively expensive; do it once in
  `MjmlTemplateRenderer.create`, never per send.
- **Validate at build time.** `validationLevel: 'strict'` throws on malformed MJML so a
  broken template fails fast instead of shipping degraded HTML.

## Module registration

```typescript
import { Module } from '@nestjs/common'
import { BymaxNotificationModule } from '@bymax-one/nest-notification'
import { MjmlTemplateRenderer } from './mjml-template-renderer'

const welcome = {
  'welcome::en': {
    subject: 'Welcome to {{appName}}',
    mjml: `
      <mjml>
        <mj-body>
          <mj-section>
            <mj-column>
              <mj-text>Hi {{name}}, welcome aboard!</mj-text>
            </mj-column>
          </mj-section>
        </mj-body>
      </mjml>
    `
  }
}

@Module({
  imports: [
    // Compilation is async, so the renderer is built in an async factory.
    BymaxNotificationModule.forRootAsync({
      useFactory: async () => ({
        email: {
          provider: myEmailProvider, // your IEmailProvider implementation
          defaultFrom: 'no-reply@acme.com',
          templateRenderer: await MjmlTemplateRenderer.create(welcome)
        }
      })
    })
  ]
})
export class AppModule {}
```
