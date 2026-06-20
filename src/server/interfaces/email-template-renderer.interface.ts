/**
 * @fileoverview Email template renderer contract (`IEmailTemplateRenderer`).
 * @layer domain
 *
 * Pluggable templating: the default is `{{var}}` interpolation with HTML escape;
 * consumers may plug in Handlebars / MJML / React Email by implementing this.
 */

/** A rendered email — subject + bodies ready to hand to an `IEmailProvider`. */
export interface RenderedEmail {
  subject: string
  html: string
  text?: string
}

/**
 * Email template renderer.
 *
 * Lets the email channel swap engines (simple interpolation, Handlebars, MJML,
 * React Email, …) behind one contract.
 */
export interface IEmailTemplateRenderer {
  /**
   * Renders a template to a subject + HTML (and optionally text) body.
   *
   * @param templateName - Template key (e.g. `'otp_code'`, `'welcome'`).
   * @param data - Variables to interpolate.
   * @param locale - Locale (e.g. `'en'`, `'pt-BR'`).
   * @returns The rendered email.
   * @throws Error When the template is not found.
   */
  render(
    templateName: string,
    data: Record<string, unknown>,
    locale: string
  ): Promise<RenderedEmail>

  /**
   * Whether the renderer has the template registered for the locale — lets
   * `EmailService` fail early when a template is missing.
   */
  hasTemplate(templateName: string, locale: string): Promise<boolean>

  /** Renderer name (e.g. `'default-interpolation'`, `'handlebars'`). */
  readonly name: string
}
