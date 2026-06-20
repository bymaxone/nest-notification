/**
 * @fileoverview Default `{{var}}`-interpolation email template renderer.
 * @layer infrastructure
 *
 * A minimal renderer: `{{var}}` substitution with automatic HTML escaping in the
 * html body only. It is deliberately not a full templating engine (no `{{#if}}`,
 * no `{{#each}}`, no partials) — consumers needing that plug in
 * Handlebars/MJML/React Email via `IEmailTemplateRenderer`.
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
export interface TemplateDefinition {
  subject: string
  html: string
  text?: string
}

/** Behaviour when an interpolated variable is absent from the render data. */
export type MissingVariableMode = 'empty' | 'throw'

/** Construction options for {@link DefaultTemplateRenderer}. */
export interface DefaultTemplateRendererOptions {
  /** Templates keyed by `${templateName}::${locale}`. */
  templates?: Record<string, TemplateDefinition>
  /** Locale chain tried after the requested one. Defaults to `['en']`. */
  fallbackLocales?: readonly string[]
  /** Missing-variable behaviour: `'empty'` (default) renders `''`; `'throw'` errors. */
  onMissingVar?: MissingVariableMode
  /** When `true`, `{{user.name}}` resolves nested data; otherwise it is a flat key. */
  enableNestedPaths?: boolean
}

/** Matches `{{ path }}` placeholders; the path may contain dots for nested access. */
const TEMPLATE_VAR_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g

/** Default locale chain tried after the requested locale. */
const DEFAULT_FALLBACK_LOCALES: readonly string[] = ['en']

/**
 * Default renderer based on `{{var}}` interpolation with html-only escaping.
 *
 * Supports a configurable locale fallback chain, optional nested-path resolution,
 * a missing-variable policy, and fail-fast validation of registered templates at
 * construction. It does NOT support conditionals (`{{#if}}`), iteration
 * (`{{#each}}`), or partials — plug a richer engine for those.
 *
 * @example
 * ```ts
 * const renderer = new DefaultTemplateRenderer({
 *   templates: { 'otp_code::en': { subject: 'Code', html: '<p>Hi {{user.name}}</p>' } },
 *   fallbackLocales: ['en'],
 *   enableNestedPaths: true
 * })
 * await renderer.render('otp_code', { user: { name: 'Jane' } }, 'pt-BR')
 * ```
 */
@Injectable()
export class DefaultTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'default-interpolation'
  private readonly templates: ReadonlyMap<string, TemplateDefinition>
  private readonly fallbackLocales: readonly string[]
  private readonly onMissingVar: MissingVariableMode
  private readonly enableNestedPaths: boolean

  /**
   * @param options - Templates plus locale/missing-variable/nested-path policy.
   * @throws Error When a registered template lacks a string `subject`/`html`, or
   * carries a non-string `text`.
   */
  constructor(options: DefaultTemplateRendererOptions = {}) {
    const entries = Object.entries(options.templates ?? {})
    for (const [key, template] of entries) {
      this.assertValidTemplate(key, template)
    }
    this.templates = new Map(entries)
    this.fallbackLocales = options.fallbackLocales ?? DEFAULT_FALLBACK_LOCALES
    this.onMissingVar = options.onMissingVar ?? 'empty'
    this.enableNestedPaths = options.enableNestedPaths ?? false
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
   * @param data - Variables to interpolate.
   * @param locale - Requested locale; resolved via the fallback chain.
   * @returns The rendered subject + html (+ text when the template has one).
   * @throws Error When no template in the fallback chain matches, or a variable is
   * missing and `onMissingVar` is `'throw'`.
   */
  async render(
    templateName: string,
    data: Record<string, unknown>,
    locale: string
  ): Promise<RenderedEmail> {
    const template = this.resolveTemplate(templateName, locale)
    const resolve = this.buildResolver(data)
    return {
      subject: this.interpolate(template.subject, false, resolve),
      html: this.interpolate(template.html, true, resolve),
      ...(template.text !== undefined
        ? { text: this.interpolate(template.text, false, resolve) }
        : {})
    }
  }

  /** Resolves the first registered template along `[locale, ...fallbackLocales]`. */
  private resolveTemplate(templateName: string, locale: string): TemplateDefinition {
    const chain = [locale, ...this.fallbackLocales.filter((candidate) => candidate !== locale)]
    for (const candidate of chain) {
      const template = this.templates.get(this.key(templateName, candidate))
      if (template) {
        return template
      }
    }
    throw new Error(
      `Template not found: ${templateName} (locale=${locale}, tried=${chain.join(',')})`
    )
  }

  /** Replaces every `{{path}}` placeholder, escaping only when `escape` is `true`. */
  private interpolate(source: string, escape: boolean, resolve: (path: string) => unknown): string {
    return source.replace(TEMPLATE_VAR_PATTERN, (_match: string, path: string): string => {
      const value = resolve(path)
      if (value === undefined || value === null) {
        if (this.onMissingVar === 'throw') {
          throw new Error(`Missing template variable: ${path}`)
        }
        return ''
      }
      const stringValue = String(value)
      return escape ? this.escapeHtml(stringValue) : stringValue
    })
  }

  /**
   * Builds a variable resolver for one render call. Lookups go through a `Map`
   * built from own enumerable entries (never bracket indexing) so neither flat
   * nor nested resolution can reach inherited/prototype keys.
   */
  private buildResolver(data: Record<string, unknown>): (path: string) => unknown {
    if (!this.enableNestedPaths) {
      const values = new Map(Object.entries(data))
      return (path: string): unknown => values.get(path)
    }
    return (path: string): unknown => this.resolveNested(data, path)
  }

  /** Walks a dotted path through own enumerable keys, stopping at any non-object. */
  private resolveNested(data: Record<string, unknown>, path: string): unknown {
    let current: unknown = data
    for (const key of path.split('.')) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = new Map(Object.entries(current as Record<string, unknown>)).get(key)
    }
    return current
  }

  /**
   * Validates a registered template shape, throwing on the offending key. The
   * optional `text` body, when present, must be a string — a non-string `text`
   * would otherwise pass construction and crash at render time inside
   * `String.prototype.replace`.
   */
  private assertValidTemplate(key: string, template: unknown): void {
    const shape = template as Partial<TemplateDefinition> | null
    if (
      shape === null ||
      typeof shape !== 'object' ||
      typeof shape.subject !== 'string' ||
      typeof shape.html !== 'string' ||
      (shape.text !== undefined && typeof shape.text !== 'string')
    ) {
      throw new Error(`Invalid template "${key}" — must have { subject: string, html: string }`)
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
