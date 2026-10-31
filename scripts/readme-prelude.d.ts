/**
 * @fileoverview The names a README snippet uses without declaring them, typed against
 * the published package. `check-published-surface.mjs` copies this file into the
 * throwaway consumer it compiles the snippets in, so a call made through one of these
 * names is checked against the real types instead of resolving to `any`. Only names
 * the surrounding prose introduces belong here; a wrong option, method or field on a
 * package type is a real error and must stay one.
 * @layer scripts
 */
import type {
  EmailService,
  INotificationLogRepository,
  NotificationService,
  OtpService,
  RedisOtpStorage
} from '@bymax-one/nest-notification'

declare global {
  /** What `this` holds in a snippet that shows service calls without a class around them. */
  interface SnippetContext {
    emailService: EmailService
    otpService: OtpService
    notificationService: NotificationService
  }

  const emailService: EmailService
  const otpService: OtpService
  const notificationService: NotificationService

  /** The Redis client the Production snippet passes to `RedisOtpStorage`. */
  const redis: ConstructorParameters<typeof RedisOtpStorage>[0]['redisClient']
  /** The Resend API key the snippets read from their own configuration. */
  const apiKey: string
  /** The application's Prisma client, which the library never imports. */
  const prisma: unknown
  /** Values a controller snippet takes from its request and its template step. */
  const tenantId: string
  const user: { email: string }
  const rendered: string
  /** A thrown error as the frontend snippet receives it. */
  const error: { code: string }
  function submitToBackend(code: string): Promise<void>

  /** Defined by the Audit Log snippet that precedes the one using it. */
  class PrismaNotificationLogRepository implements INotificationLogRepository {
    constructor(prisma: unknown)
    readonly name: string
    create: INotificationLogRepository['create']
  }
}
