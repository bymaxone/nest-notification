import { HttpStatus } from '@nestjs/common'

import { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'

import {
  NOTIFICATION_ERROR_DEFINITIONS,
  NOTIFICATION_ERROR_CODES as RE_EXPORTED_ERROR_CODES,
  type NotificationErrorKey
} from './notification-error-codes'
import { NotificationException } from './notification-exception'

describe('NotificationException', () => {
  // The exception must surface the catalog code and HTTP status so the NestJS
  // exception filter responds with the right contract.
  it('should expose the code and HTTP status from the definition', () => {
    const exception = new NotificationException('OTP_INVALID_CODE')

    expect(exception.code).toBe(NOTIFICATION_ERROR_CODES.OTP_INVALID_CODE)
    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED)
  })

  // Structured context handed in must land under `error.details` so callers can
  // read machine-readable failure data.
  it('should embed details in the response body shape', () => {
    const exception = new NotificationException('OTP_INVALID_LENGTH', {
      provided: 0,
      allowed: '1-32'
    })

    expect(exception.getResponse()).toEqual({
      error: {
        code: NOTIFICATION_ERROR_CODES.OTP_INVALID_LENGTH,
        message: 'Invalid OTP length config',
        details: { provided: 0, allowed: '1-32' }
      }
    })
  })

  // When no details are supplied, `error.details` must default to null rather
  // than be omitted — the shape is a stable contract.
  it('should default details to null when not provided', () => {
    const response = new NotificationException('EMAIL_SEND_FAILED').getResponse() as {
      error: { details: unknown }
    }

    expect(response.error.details).toBeNull()
  })

  // A caller may need a different status (e.g. 403 vs 401); the override must win.
  it('should allow overriding the HTTP status', () => {
    const exception = new NotificationException('OTP_INVALID_CODE', undefined, HttpStatus.FORBIDDEN)

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN)
  })

  // A caller may need a custom message; the override must replace the default.
  it('should allow overriding the message', () => {
    const exception = new NotificationException(
      'OTP_INVALID_CODE',
      undefined,
      undefined,
      'Custom message'
    )
    const response = exception.getResponse() as { error: { message: string } }

    expect(response.error.message).toBe('Custom message')
  })

  // The options-object form must override the status exactly like the positional form.
  it('should allow overriding the HTTP status via the options object', () => {
    const exception = new NotificationException('OTP_INVALID_CODE', undefined, {
      status: HttpStatus.FORBIDDEN
    })

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN)
  })

  // The options-object form must override the message exactly like the positional form.
  it('should allow overriding the message via the options object', () => {
    const exception = new NotificationException('OTP_INVALID_CODE', undefined, {
      message: 'Custom message'
    })
    const response = exception.getResponse() as { error: { message: string } }

    expect(response.error.message).toBe('Custom message')
  })

  // When both forms are supplied, the options object wins over the positional override.
  it('should prefer options.message over the positional overrideMessage', () => {
    const exception = new NotificationException(
      'OTP_INVALID_CODE',
      undefined,
      { message: 'From options' },
      'From positional'
    )
    const response = exception.getResponse() as { error: { message: string } }

    expect(response.error.message).toBe('From options')
  })

  // The underlying error must surface as the native `Error.cause` so cause-walking
  // log serializers can report WHY a notification failed — but as a log-safe COPY
  // (name/message/stack), never the raw object.
  it('should expose options.cause as a log-safe Error.cause copy', () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:1099')
    const exception = new NotificationException(
      'EMAIL_SEND_FAILED',
      { providerName: 'smtp' },
      { cause }
    )
    const stored = exception.cause as Error

    expect(stored).not.toBe(cause)
    expect(stored).toBeInstanceOf(Error)
    expect(stored.name).toBe(cause.name)
    expect(stored.message).toBe(cause.message)
    expect(stored.stack).toBe(cause.stack)
  })

  // SECURITY: provider/SDK errors routinely retain the request payload in extra
  // properties (axios-style `config.data`) — for an OTP email that payload holds
  // the code. Sanitization must drop every property beyond name/message/stack.
  it('should drop extra properties from the cause so retained payloads cannot leak', () => {
    const cause = Object.assign(new Error('request failed'), {
      config: { data: '<p>Your code is 998877</p>' },
      response: { body: 'code=998877' }
    })
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause })
    const stored = exception.cause as Error

    expect(JSON.stringify({ ...stored })).not.toContain('998877')
    expect(Object.keys(stored)).toEqual([])
    expect(stored.message).toBe('request failed')
  })

  // The nested cause chain survives sanitization level by level — each link keeps
  // name/message and loses its extra properties.
  it('should sanitize the nested cause chain recursively', () => {
    const inner = Object.assign(new Error('inner detail'), { payload: 'code=998877' })
    const outer = new Error('outer failure', { cause: inner })
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause: outer })
    const storedInner = (exception.cause as Error).cause as Error

    expect(storedInner).not.toBe(inner)
    expect(storedInner.message).toBe('inner detail')
    expect(Object.keys(storedInner)).toEqual([])
  })

  // A self-referential cause chain must terminate at the depth bound instead of
  // recursing forever — pins the MAX_CAUSE_DEPTH boundary exactly.
  it('should bound the sanitized cause chain depth', () => {
    const cyclic = new Error('loops')
    cyclic.cause = cyclic
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause: cyclic })

    let depth = 0
    let cursor: unknown = exception.cause
    while (cursor instanceof Error && 'cause' in cursor) {
      depth += 1
      cursor = cursor.cause
    }
    // Levels 0..4 carry a `cause` link; the level-5 copy is the bounded leaf.
    expect(depth).toBe(5)
    expect(cursor instanceof Error && 'cause' in cursor).toBe(false)
  })

  // An Error whose stack was stripped must not poison the copy with an
  // `undefined` stack — the copy keeps its own defined stack string.
  it('should keep a defined stack when the original error has none', () => {
    const bare = new Error('no stack')
    delete bare.stack
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause: bare })
    const stored = exception.cause as Error

    expect(stored.message).toBe('no stack')
    expect(typeof stored.stack).toBe('string')
  })

  // An Error without a cause of its own must produce a copy with NO `cause` key
  // at all — never a phantom `cause: undefined`.
  it('should not install a cause key on a sanitized error that has none', () => {
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, {
      cause: new Error('flat')
    })

    expect('cause' in (exception.cause as Error)).toBe(false)
  })

  // A non-Error OBJECT cause is flattened to its String() form — an arbitrary
  // object can retain payloads just like an SDK error, so it never passes raw.
  it('should flatten a non-Error object cause to its string form', () => {
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, {
      cause: { data: 'code=998877' }
    })

    expect(exception.cause).toBe('[object Object]')
  })

  // A CUSTOM error name must survive the copy — pins the `name` transfer against
  // the prototype default masking it (every `new Error` is already named 'Error').
  it('should preserve a custom error name on the sanitized cause', () => {
    const cause = new Error('refused')
    cause.name = 'SmtpConnectionError'
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause })

    expect((exception.cause as Error).name).toBe('SmtpConnectionError')
  })

  // A `null` cause must pass through verbatim (falsy → never installed), NOT be
  // flattened to the truthy string 'null' — pins the `!== null` guard.
  it('should not install a null cause', () => {
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause: null })

    expect('cause' in exception).toBe(false)
  })

  // SECURITY: the cause carries internal error text and must never leak into the
  // serialized HTTP response body handed to clients.
  it('should keep the cause out of the response body', () => {
    const cause = new Error('internal storage detail')
    const exception = new NotificationException('AUDIT_LOG_FAILED', undefined, { cause })

    expect(JSON.stringify(exception.getResponse())).not.toContain('internal storage detail')
  })

  // A hostile cause whose fields THROW when read must not break construction —
  // the sanitizer falls back to a minimal, non-sensitive cause instead of
  // letting the getter's (potentially secret-bearing) error escape.
  it('should fall back to a minimal cause when inspecting the original throws', () => {
    const hostile = new Error('shell')
    Object.defineProperty(hostile, 'message', {
      get: (): never => {
        throw new Error('getter leaked 998877')
      }
    })

    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause: hostile })

    expect((exception.cause as Error).message).toBe('Cause unavailable: inspecting it threw')
    expect(JSON.stringify(exception.getResponse())).not.toContain('998877')
  })

  // The sanitized copies stay writable so a downstream secret scrub can still
  // redact them — pins the `writable` descriptors on `name` and `cause`.
  it('should keep sanitized cause copies writable for downstream scrubs', () => {
    const cause = new Error('outer', { cause: 'inner tail' })
    cause.name = 'OuterName'
    const exception = new NotificationException('EMAIL_SEND_FAILED', undefined, { cause })
    const stored = exception.cause as Error

    expect(Reflect.set(stored, 'name', 'Renamed')).toBe(true)
    expect(stored.name).toBe('Renamed')
    expect(Reflect.set(stored, 'cause', 'replaced')).toBe(true)
    expect(stored.cause).toBe('replaced')
  })

  // Without a cause the property must be genuinely absent — never `cause: undefined`.
  it('should not install a cause when none is given', () => {
    const exception = new NotificationException('OTP_INVALID_CODE')

    expect('cause' in exception).toBe(false)
  })

  // Every catalog key must produce a well-formed exception — guards against a
  // definition with a missing code/status/message.
  it('should build a valid exception for every catalog key', () => {
    for (const key of Object.keys(NOTIFICATION_ERROR_DEFINITIONS) as NotificationErrorKey[]) {
      const exception = new NotificationException(key)
      const response = exception.getResponse() as { error: { code: string } }

      expect(response.error.code).toBe(NOTIFICATION_ERROR_DEFINITIONS[key].code)
      expect(typeof exception.getStatus()).toBe('number')
    }
  })

  // Defensive path: an untyped caller passing an unknown key must still get a
  // well-formed 500 envelope, never a raw TypeError.
  it('should fall back to a generic 500 for an unknown key', () => {
    const exception = new NotificationException('NOT_A_REAL_KEY' as NotificationErrorKey)
    const response = exception.getResponse() as { error: { code: string; message: string } }

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(response.error.code).toBe('notification.unknown_error')
    // Pin the fallback message string literal too.
    expect(response.error.message).toBe('Unknown notification error')
  })
})

describe('NOTIFICATION_ERROR_DEFINITIONS', () => {
  // The server catalog and the shared code list are intentionally duplicated;
  // they must stay byte-for-byte identical so a frontend matching on a shared
  // code always finds the server's response code.
  it('should match the shared NOTIFICATION_ERROR_CODES byte-for-byte', () => {
    const serverCodes = Object.values(NOTIFICATION_ERROR_DEFINITIONS)
      .map((definition) => definition.code)
      .sort()
    const sharedCodes = Object.values(NOTIFICATION_ERROR_CODES).sort()

    expect(serverCodes).toEqual(sharedCodes)
  })

  // The catalog module re-exports the shared codes for convenience; that
  // re-export must point at the exact same object the shared subpath publishes.
  it('should re-export the shared NOTIFICATION_ERROR_CODES unchanged', () => {
    expect(RE_EXPORTED_ERROR_CODES).toBe(NOTIFICATION_ERROR_CODES)
  })
})
