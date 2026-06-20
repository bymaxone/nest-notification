# Handlebars `IEmailTemplateRenderer` adapter (reference example)

> **Reference only — copy and adapt to your project.** `@bymax-one/nest-notification`
> ships **no** Handlebars dependency and **no** HTML. This file documents how to plug
> [Handlebars](https://handlebarsjs.com/) in as a custom renderer when you need
> conditionals (`{{#if}}`), iteration (`{{#each}}`), partials, or helpers that the
> built-in `DefaultTemplateRenderer` deliberately does not support.

Verified against `handlebars@^4`.

## Setup

```bash
pnpm add handlebars
```

## Implementation

The adapter compiles every registered template once in the constructor (compilation
is cached by Handlebars) and resolves the requested locale with a hard fallback to
`en`, matching the library's `${templateName}::${locale}` keying convention.

```typescript
import Handlebars from 'handlebars'
import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '@bymax-one/nest-notification'

interface RawTemplate {
  subject: string
  html: string
  text?: string
}

interface CompiledTemplate {
  subject: HandlebarsTemplateDelegate
  html: HandlebarsTemplateDelegate
  text?: HandlebarsTemplateDelegate
}

/**
 * Renders email templates with Handlebars. Keys follow the library convention
 * `${templateName}::${locale}` (e.g. `welcome::pt-BR`).
 */
export class HandlebarsTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'handlebars'
  private readonly compiled = new Map<string, CompiledTemplate>()

  constructor(templates: Record<string, RawTemplate>) {
    for (const [key, template] of Object.entries(templates)) {
      this.compiled.set(key, {
        subject: Handlebars.compile(template.subject),
        html: Handlebars.compile(template.html),
        ...(template.text !== undefined
          ? { text: Handlebars.compile(template.text) }
          : {})
      })
    }
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
      this.compiled.get(`${templateName}::${locale}`) ??
      this.compiled.get(`${templateName}::en`)
    if (!template) {
      throw new Error(`Template not found: ${templateName} (locale=${locale})`)
    }
    return {
      subject: template.subject(data),
      html: template.html(data),
      ...(template.text !== undefined ? { text: template.text(data) } : {})
    }
  }
}
```

## Security caveats

- **Prefer `{{var}}` over `{{{var}}}`.** Handlebars HTML-escapes `{{var}}` by default,
  which is what you want for user-supplied values. The triple-stache `{{{var}}}`
  emits the value **raw** and reintroduces the stored-XSS vector the default renderer
  guards against. Only use it for trusted, pre-sanitized HTML.
- **`SafeString` also bypasses escaping.** Wrapping a value in
  `new Handlebars.SafeString(...)` marks it as raw — never wrap unsanitized input.
- **Escape the html body only.** As with the default renderer, the `subject` and
  `text` outputs are not HTML contexts; do not double-escape them.
- **Register helpers from a trusted source only.** A malicious helper can read or
  mutate the data context.

## Module registration

```typescript
import { BymaxNotificationModule } from '@bymax-one/nest-notification'
import { HandlebarsTemplateRenderer } from './handlebars-template-renderer'

const templateRenderer = new HandlebarsTemplateRenderer({
  'otp_code::en': {
    subject: 'Your {{appName}} code',
    html: '<p>Hi {{name}}, your code is <strong>{{code}}</strong>.</p>',
    text: 'Hi {{name}}, your code is {{code}}.'
  }
})

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      email: {
        provider: myEmailProvider,
        defaultFrom: 'no-reply@acme.com',
        templateRenderer
      }
    })
  ]
})
export class AppModule {}
```
