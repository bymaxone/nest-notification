/**
 * @fileoverview The `BymaxNotificationModule` dynamic module.
 * @layer infrastructure
 *
 * Registers only the channels the consumer configures (opt-in), wiring each
 * provider/storage/renderer/repository under a `Symbol` DI token. `forRoot` is
 * fully synchronous; `forRootAsync` resolves the options through DI. Channel
 * service providers (email/OTP services) are added once those services exist.
 */

import { Logger, Module } from '@nestjs/common'
import type {
  ClassProvider,
  DynamicModule,
  FactoryProvider,
  Type,
  ValueProvider
} from '@nestjs/common'

import {
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_OTP_STORAGE,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER
} from './bymax-notification.constants'
import { resolveOptions } from './config/resolved-options'
import type { ResolvedNotificationOptions } from './config/resolved-options'
import { validateOptions } from './config/validate-options'
import type {
  BymaxNotificationModuleAsyncOptions,
  BymaxNotificationModuleOptions
} from './interfaces/notification-module-options.interface'
import { DefaultTemplateRenderer } from './providers/default-template-renderer'
import { NoOpNotificationLogRepository } from './providers/no-op-notification-log.repository'
import { EmailService } from './services/email.service'
import { NotificationService } from './services/notification.service'
import { OtpService } from './services/otp.service'

/** A DI provider that carries a `provide` token (excludes bare-class providers). */
type TokenProvider = ClassProvider | ValueProvider | FactoryProvider

/**
 * Multi-channel notification module.
 *
 * @example
 * ```ts
 * BymaxNotificationModule.forRoot({
 *   email: { provider: new ResendEmailProvider({ apiKey }), defaultFrom: 'noreply@acme.com' }
 * })
 * ```
 */
@Module({})
export class BymaxNotificationModule {
  private static readonly logger = new Logger(BymaxNotificationModule.name)

  /**
   * Registers the module synchronously from static options.
   *
   * @param options - The channel configuration; at least one channel is required.
   * @returns A global `DynamicModule` exposing only the configured channels' tokens.
   * @throws Error When validation fails (no channel, malformed channel, or an unsupported channel).
   */
  static forRoot(options: BymaxNotificationModuleOptions): DynamicModule {
    validateOptions(options)
    const resolved = resolveOptions(options)
    const tokenProviders = this.buildProviders(options, resolved)
    const serviceProviders = this.buildServiceProviders(resolved)
    this.logger.log(
      `[BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK] Initialized with channels: ${activeChannels(resolved).join(', ')}`
    )
    return {
      module: BymaxNotificationModule,
      global: true,
      providers: [...tokenProviders, ...serviceProviders],
      exports: [...tokenProviders.map((provider) => provider.provide), ...serviceProviders]
    }
  }

  /**
   * Registers the module with options resolved at runtime through DI.
   *
   * v0.1 wires only the options provider via `useFactory` + `inject`; channel
   * providers are added once the async wiring is completed.
   *
   * @param asyncOptions - The async options factory and its dependencies.
   * @returns A global `DynamicModule` exposing the resolved options token.
   */
  static forRootAsync(asyncOptions: BymaxNotificationModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider = {
      provide: BYMAX_NOTIFICATION_OPTIONS,
      useFactory: async (...args: never[]): Promise<Readonly<ResolvedNotificationOptions>> => {
        const options = await asyncOptions.useFactory(...args)
        validateOptions(options)
        return resolveOptions(options)
      },
      inject: asyncOptions.inject ?? []
    }
    return {
      module: BymaxNotificationModule,
      global: true,
      imports: asyncOptions.imports ?? [],
      providers: [optionsProvider],
      exports: [BYMAX_NOTIFICATION_OPTIONS]
    }
  }

  /** Assembles the provider list for the configured channels. */
  private static buildProviders(
    options: BymaxNotificationModuleOptions,
    resolved: Readonly<ResolvedNotificationOptions>
  ): TokenProvider[] {
    const providers: TokenProvider[] = [
      { provide: BYMAX_NOTIFICATION_OPTIONS, useValue: resolved },
      options.audit?.repository
        ? resolveAsProvider(BYMAX_NOTIFICATION_LOG_REPOSITORY, options.audit.repository)
        : { provide: BYMAX_NOTIFICATION_LOG_REPOSITORY, useClass: NoOpNotificationLogRepository }
    ]
    if (resolved.email && options.email) {
      providers.push(resolveAsProvider(BYMAX_NOTIFICATION_EMAIL_PROVIDER, options.email.provider))
      providers.push(resolveRenderer(options.email.templateRenderer))
    }
    if (resolved.otp && options.otp) {
      providers.push(resolveAsProvider(BYMAX_NOTIFICATION_OTP_STORAGE, options.otp.storage))
    }
    return providers
  }

  /**
   * Builds the channel service providers. `EmailService`/`OtpService` are
   * registered only when their channel is configured; `NotificationService` is
   * always registered (it injects the channel services with `@Optional()`).
   */
  private static buildServiceProviders(
    resolved: Readonly<ResolvedNotificationOptions>
  ): Type<unknown>[] {
    const services: Type<unknown>[] = []
    if (resolved.email) {
      services.push(EmailService)
    }
    if (resolved.otp) {
      services.push(OtpService)
    }
    services.push(NotificationService)
    return services
  }
}

/**
 * Lists the configured channels for the bootstrap log line. Validation guarantees
 * at least one delivery channel, so the result is always non-empty.
 */
function activeChannels(resolved: Readonly<ResolvedNotificationOptions>): string[] {
  const channels: string[] = []
  if (resolved.email) {
    channels.push('email')
  }
  if (resolved.otp) {
    channels.push('otp')
  }
  return channels
}

/** Builds the template-renderer provider, defaulting to {@link DefaultTemplateRenderer}. */
function resolveRenderer(renderer: unknown): TokenProvider {
  if (renderer === undefined) {
    return {
      provide: BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
      useFactory: (): DefaultTemplateRenderer => new DefaultTemplateRenderer({})
    }
  }
  return resolveAsProvider(BYMAX_NOTIFICATION_TEMPLATE_RENDERER, renderer)
}

/**
 * Wires a consumer-supplied instance OR class under a token. A class reference
 * becomes a `useClass` provider; a ready instance becomes a `useValue` provider.
 * Prefer passing instances — a class whose constructor needs runtime values
 * NestJS cannot resolve must be supplied as an instance.
 */
function resolveAsProvider(token: symbol, valueOrClass: unknown): ClassProvider | ValueProvider {
  if (isType(valueOrClass)) {
    return { provide: token, useClass: valueOrClass }
  }
  return { provide: token, useValue: valueOrClass }
}

/** Detects whether a provider value is a class/constructor (vs a ready instance). */
function isType(value: unknown): value is Type<unknown> {
  return typeof value === 'function'
}
