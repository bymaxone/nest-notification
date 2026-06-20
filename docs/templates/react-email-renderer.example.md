# React Email `IEmailTemplateRenderer` adapter (reference example)

> **Reference only — copy and adapt to your project.** `@bymax-one/nest-notification`
> ships **no** React Email dependency and **no** components. This file documents how to
> render [React Email](https://react.email/) components through the custom-renderer
> interface, so you can author email templates as type-safe React components.

Verified against `@react-email/render@^1` (the `render` function is **async** and
returns a `Promise<string>`).

## Setup

```bash
pnpm add @react-email/render @react-email/components react
```

## Implementation

Each template entry pairs a `subject` factory with a React `component`. `render(...)`
is awaited to produce the HTML; passing `{ plainText: true }` produces the text body.

```typescript
import { createElement, type ComponentType } from 'react'
import { render } from '@react-email/render'
import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '@bymax-one/nest-notification'

interface ReactTemplate {
  subject: (data: Record<string, unknown>) => string
  component: ComponentType<Record<string, unknown>>
}

/**
 * Renders email templates from React Email components. Keys follow the library
 * convention `${templateName}::${locale}`.
 */
export class ReactEmailTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'react-email'

  constructor(private readonly templates: Record<string, ReactTemplate>) {}

  async hasTemplate(templateName: string, locale: string): Promise<boolean> {
    return Boolean(this.templates[`${templateName}::${locale}`])
  }

  async render(
    templateName: string,
    data: Record<string, unknown>,
    locale: string
  ): Promise<RenderedEmail> {
    const template =
      this.templates[`${templateName}::${locale}`] ??
      this.templates[`${templateName}::en`]
    if (!template) {
      throw new Error(`Template not found: ${templateName} (locale=${locale})`)
    }
    const element = createElement(template.component, data)
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true })
    ])
    return { subject: template.subject(data), html, text }
  }
}
```

## Security caveats

- **React escapes interpolated values automatically.** Rendering `{user.name}` inside
  a component escapes HTML-significant characters for you — no extra escaping needed.
- **`dangerouslySetInnerHTML` opts out of that protection.** Never feed unsanitized
  user input through it; that reopens the stored-XSS vector.
- **`render` is async.** Always `await` it (or `Promise.all` the html + text passes);
  forgetting to await yields `[object Promise]` in the email body.
- **The subject is plain text.** Build it with a small factory (`subject(data)`), not a
  React component, so it never carries markup.

## Module registration

```typescript
import { BymaxNotificationModule } from '@bymax-one/nest-notification'
import { ReactEmailTemplateRenderer } from './react-email-template-renderer'
import { OtpCodeEmail } from './emails/otp-code'

const templateRenderer = new ReactEmailTemplateRenderer({
  'otp_code::en': {
    subject: (data) => `Your code is ${String(data.code)}`,
    component: OtpCodeEmail as ReactEmailTemplateRenderer['templates'][string]['component']
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
