/**
 * @fileoverview The `BymaxNotificationModule` dynamic module.
 * @layer infrastructure
 *
 * Registers only the channels the consumer configures (opt-in), wiring each
 * provider/storage/renderer/repository under a `Symbol` DI token. `forRoot` is
 * fully synchronous and registers a channel's token only when that channel is
 * present. `forRootAsync` resolves the consumer options through DI: because the
 * configured channels are unknown until the factory runs, it registers every
 * channel token (an absent channel resolves to `null`) and always registers the
 * three services, which guard against their absent channel internally.
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
import type { IEmailProvider } from './interfaces/email-provider.interface'
import type { IEmailTemplateRenderer } from './interfaces/email-template-renderer.interface'
import type { INotificationLogRepository } from './interfaces/notification-log-repository.interface'
import type {
  BymaxNotificationModuleAsyncOptions,
  BymaxNotificationModuleOptions
} from './interfaces/notification-module-options.interface'
import type { IOtpStorage } from './interfaces/otp-storage.interface'
import { DefaultTemplateRenderer } from './providers/default-template-renderer'
import { NoOpNotificationLogRepository } from './providers/no-op-notification-log.repository'
import { EmailService } from './services/email.service'
import { NotificationService } from './services/notification.service'
import { OtpService } from './services/otp.service'

/** A DI provider that carries a `provide` token (excludes bare-class providers). */
type TokenProvider = ClassProvider | ValueProvider | FactoryProvider

/**
 * Internal token holding the validated RAW async options. Unlike
 * `BYMAX_NOTIFICATION_OPTIONS` (scalar, frozen, service-facing), the raw options
 * still carry the provider/storage/renderer/repository instances the channel
 * token factories need. Module-private — never exported.
 */
const RAW_NOTIFICATION_OPTIONS = Symbol('RAW_NOTIFICATION_OPTIONS')

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
   * v0.1 supports the `useFactory` + `inject` form only — `useClass`/`useExisting`
   * are rejected with an explicit error. The factory runs once (under an internal
   * token); every channel token and all three services derive from its result, so
   * a `ConfigService`-driven async bootstrap wires the same graph as `forRoot`.
   *
   * @param asyncOptions - The async options factory and its dependencies.
   * @returns A global `DynamicModule` exposing the resolved options token, every
   * channel token, and the three services.
   * @throws Error When `useClass`/`useExisting` is supplied, or `useFactory` is missing.
   */
  static forRootAsync(asyncOptions: BymaxNotificationModuleAsyncOptions): DynamicModule {
    assertUseFactory(asyncOptions)
    const rawOptionsProvider: FactoryProvider = {
      provide: RAW_NOTIFICATION_OPTIONS,
      useFactory: async (...args: never[]): Promise<BymaxNotificationModuleOptions> => {
        const options = await asyncOptions.useFactory(...args)
        validateOptions(options)
        return options
      },
      inject: asyncOptions.inject ?? []
    }
    const tokenProviders = this.buildAsyncTokenProviders()
    const serviceProviders: Type<unknown>[] = [EmailService, OtpService, NotificationService]
    return {
      module: BymaxNotificationModule,
      global: true,
      imports: asyncOptions.imports ?? [],
      providers: [rawOptionsProvider, ...tokenProviders, ...serviceProviders],
      exports: [
        BYMAX_NOTIFICATION_OPTIONS,
        BYMAX_NOTIFICATION_LOG_REPOSITORY,
        BYMAX_NOTIFICATION_EMAIL_PROVIDER,
        BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
        BYMAX_NOTIFICATION_OTP_STORAGE,
        ...serviceProviders
      ]
    }
  }

  /**
   * Builds the async channel-token factories. Each derives from the validated raw
   * options under {@link RAW_NOTIFICATION_OPTIONS}: an unconfigured email/OTP token
   * resolves to `null` (the owning service guards against it), the audit token
   * defaults to {@link NoOpNotificationLogRepository}, and the renderer defaults to
   * {@link DefaultTemplateRenderer}.
   */
  private static buildAsyncTokenProviders(): FactoryProvider[] {
    return [
      {
        provide: BYMAX_NOTIFICATION_OPTIONS,
        useFactory: (raw: BymaxNotificationModuleOptions): Readonly<ResolvedNotificationOptions> =>
          resolveOptions(raw),
        inject: [RAW_NOTIFICATION_OPTIONS]
      },
      {
        provide: BYMAX_NOTIFICATION_LOG_REPOSITORY,
        useFactory: (raw: BymaxNotificationModuleOptions): INotificationLogRepository =>
          raw.audit ? instantiate(raw.audit.repository) : new NoOpNotificationLogRepository(),
        inject: [RAW_NOTIFICATION_OPTIONS]
      },
      {
        provide: BYMAX_NOTIFICATION_EMAIL_PROVIDER,
        useFactory: (raw: BymaxNotificationModuleOptions): IEmailProvider | null =>
          raw.email ? instantiate(raw.email.provider) : null,
        inject: [RAW_NOTIFICATION_OPTIONS]
      },
      {
        provide: BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
        useFactory: (raw: BymaxNotificationModuleOptions): IEmailTemplateRenderer =>
          raw.email?.templateRenderer
            ? instantiate(raw.email.templateRenderer)
            : new DefaultTemplateRenderer({}),
        inject: [RAW_NOTIFICATION_OPTIONS]
      },
      {
        provide: BYMAX_NOTIFICATION_OTP_STORAGE,
        useFactory: (raw: BymaxNotificationModuleOptions): IOtpStorage | null =>
          raw.otp ? instantiate(raw.otp.storage) : null,
        inject: [RAW_NOTIFICATION_OPTIONS]
      }
    ]
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

/**
 * Validates the async options form. v0.1 wires `useFactory` only; `useClass` and
 * `useExisting` are reserved for v0.2 and rejected here so a consumer never boots
 * believing an unwired form took effect. The cast reads fields the public type
 * does not declare, catching plain-JS callers that bypass the compiler.
 */
function assertUseFactory(asyncOptions: BymaxNotificationModuleAsyncOptions): void {
  const candidate = asyncOptions as { useClass?: unknown; useExisting?: unknown }
  if (candidate.useClass !== undefined || candidate.useExisting !== undefined) {
    throw new Error(
      '[BymaxNotificationModule] forRootAsync supports only `useFactory` in v0.1; ' +
        '`useClass` / `useExisting` are not yet implemented (planned for v0.2).'
    )
  }
  if (typeof asyncOptions.useFactory !== 'function') {
    throw new Error('[BymaxNotificationModule] forRootAsync requires a `useFactory` function.')
  }
}

/**
 * Resolves an async provider value: a class reference is instantiated with no
 * arguments, a ready instance is returned unchanged. A class whose constructor
 * needs runtime values must be supplied as an instance (mirrors the sync rule).
 */
function instantiate<T>(valueOrClass: T | (new (...args: never[]) => T)): T {
  return typeof valueOrClass === 'function'
    ? new (valueOrClass as new (...args: never[]) => T)()
    : valueOrClass
}
