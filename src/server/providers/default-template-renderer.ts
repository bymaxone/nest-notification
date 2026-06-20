/**
 * @fileoverview Default `{{var}}`-interpolation email template renderer.
 * @layer infrastructure
 *
 * A minimal renderer: `{{var}}` substitution with automatic HTML escaping in the
 * html body only. It is deliberately not a full templating engine (no `{{#if}}`,
 * no partials) — consumers needing that plug in Handlebars/MJML/React Email via
 * `IEmailTemplateRenderer`.
 *
 * Security: variable values are HTML-escaped only in the html body, never in the
 * subject or text body (those are not HTML contexts, so escaping would surface
 * literal `&amp;`/`&lt;`). This closes a stored-XSS vector for interpolated names.
 */

import { Injectable } from '@nestjs/common'

import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '../interfaces/email-template-renderer.interface'

/** A raw template: subject + html (+ optional text) with `{{var}}` placeholders. */
export interface TemplateSource {
  subject: string
  html: string
  text?: string
}

/** Construction options for {@link DefaultTemplateRenderer}. */
export interface DefaultTemplateRendererOptions {
  /** Templates keyed by `${templateName}::${locale}`. */
  templates?: Record<string, TemplateSource>
}

/** Matches `{{ varName }}` placeholders (single identifier, optional inner spaces). */
const TEMPLATE_VAR_PATTERN = /\{\{\s*(\w+)\s*\}\}/g

/** Locale used as the fallback when the requested locale is not registered. */
const FALLBACK_LOCALE = 'en'

/** Default renderer based on `{{var}}` interpolation with html-only escaping. */
@Injectable()
export class DefaultTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'default-interpolation'
  private readonly templates: ReadonlyMap<string, TemplateSource>

  /**
   * @param options - Registered templates; defaults to an empty registry.
   */
  constructor(options: DefaultTemplateRendererOptions = {}) {
    this.templates = new Map(Object.entries(options.templates ?? {}))
  }

  /**
   * Whether a template is registered for the exact name + locale.
   *
   * @param templateName - Template name.
   * @param locale - Requested locale.
   * @returns `true` when the `${name}::${locale}` key exists.
   */
  async hasTemplate(templateName: string, locale: string): Promise<boolean> {
    return this.templates.has(this.key(templateName, locale))
  }

  /**
   * Renders a template, escaping interpolated values in the html body only.
   *
   * @param templateName - Template name.
   * @param data - Variables to interpolate; missing variables render as `''`.
   * @param locale - Requested locale; falls back to `en` when absent.
   * @returns The rendered subject + html (+ text when the template has one).
   * @throws Error When neither the requested locale nor the `en` fallback exists.
   */
  async render(
    templateName: string,
    data: Record<string, unknown>,
    locale: string
  ): Promise<RenderedEmail> {
    const template =
      this.templates.get(this.key(templateName, locale)) ??
      this.templates.get(this.key(templateName, FALLBACK_LOCALE))
    if (!template) {
      throw new Error(`Template not found: ${templateName} (locale=${locale})`)
    }
    const values = new Map(Object.entries(data))
    const fill = (source: string, escape: boolean): string =>
      source.replace(TEMPLATE_VAR_PATTERN, (_match: string, varName: string): string => {
        const value = String(values.get(varName) ?? '')
        return escape ? this.escapeHtml(value) : value
      })
    return {
      subject: fill(template.subject, false),
      html: fill(template.html, true),
      ...(template.text !== undefined ? { text: fill(template.text, false) } : {})
    }
  }

  /** Builds the `${templateName}::${locale}` registry key. */
  private key(templateName: string, locale: string): string {
    return `${templateName}::${locale}`
  }

  /** Escapes the five HTML-significant characters. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
