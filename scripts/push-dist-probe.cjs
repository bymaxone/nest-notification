/**
 * Probe run by the smoke test against the BUILT package, never against src: it wires the built
 * `./push` and `./push/fcm` entries beside the built server entry, in both module formats, and holds
 * them to what only built bundles can show. The specs run on src, where there is one copy of every module; a push
 * bundle carries its own copy of the input helpers, so the two things that must not differ are the
 * error class (one copy, the server's) and the behavior of the duplicated helpers. Exit code 0 means
 * every assertion held.
 *
 * Run from inside the package root (so the package name resolves to the package under test) with
 * NODE_PATH pointing at a node_modules that holds @nestjs/testing.
 */
'use strict'

require('reflect-metadata')
const { generateKeyPairSync } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { Test } = require('@nestjs/testing')

const failures = []
const check = (label, ok) => {
  if (!ok) failures.push(label)
}

const SEND_URL = 'https://exp.host/--/api/v2/push/send'
const FCM_NAME = 'projects/p/messages/1'
const GOOD = 'ExponentPushToken[good-token-1]'
const GOOD_2 = 'ExponentPushToken[good-token-2]'

/** A `fetch` that answers from a script and records what it was asked. */
function scripted(steps) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) })
    const step = steps.shift() ?? { status: 500 }
    return new Response(step.raw ?? JSON.stringify(step.body ?? {}), {
      status: step.status ?? 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { fetch, calls }
}

async function failureOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

async function run(format, server, push) {
  const label = (text) => `${format}: ${text}`

  // The main bundle holds no Expo code, and the push bundle names the server only by package name.
  const mainText = readFileSync(
    join(process.cwd(), `dist/server/index.${format === 'esm' ? 'mjs' : 'cjs'}`),
    'utf8'
  )
  check(
    label('the server bundle has no Expo adapter'),
    !mainText.includes('exp.host') && !mainText.includes('ExpoPushProvider')
  )
  check(
    label('the server entry no longer exports the adapter'),
    server.ExpoPushProvider === undefined
  )
  check(label('the push entry exports the adapter'), typeof push.ExpoPushProvider === 'function')

  // The adapter from `./push` plugged into the module from `.`: a good, a bad and a good token.
  const ok = scripted([
    {
      body: {
        data: [
          { status: 'ok', id: 't1' },
          { status: 'ok', id: 't2' }
        ]
      }
    }
  ])
  const provider = new push.ExpoPushProvider({ fetch: ok.fetch })
  const moduleRef = await Test.createTestingModule({
    imports: [server.BymaxNotificationModule.forRoot({ push: { provider } })]
  }).compile()
  const pushService = moduleRef.get(server.NotificationService).getPush()
  const sent = await pushService.send({
    tenantId: 'acme',
    tokens: [GOOD, 'not-a-token', GOOD_2, ''],
    title: 'T',
    body: 'B'
  })
  const reasons = sent.results.map((entry) => entry.reason)
  check(
    label('a good token gets its ticket'),
    sent.results[0]?.messageId === 't1' && sent.results[2]?.messageId === 't2'
  )
  check(
    label('a bad token and an empty one are answered token_invalid'),
    reasons[1] === 'token_invalid' && reasons[3] === 'token_invalid'
  )
  check(
    label('only the good tokens went out, once, to the fixed URL'),
    ok.calls.length === 1 && ok.calls[0].url === SEND_URL && ok.calls[0].body.length === 2
  )

  // Retry decisions of the built adapter, read through the built service.
  const limited = scripted([{ status: 429, body: { errors: [{ code: 'TOO_MANY_REQUESTS' }] } }])
  const limitedModule = await Test.createTestingModule({
    imports: [
      server.BymaxNotificationModule.forRoot({
        push: { provider: new push.ExpoPushProvider({ fetch: limited.fetch }) }
      })
    ]
  }).compile()
  const refused = await failureOf(
    limitedModule
      .get(server.NotificationService)
      .getPush()
      .send({ tenantId: 'acme', tokens: GOOD, title: 'T', body: 'B' })
  )
  check(
    label('a refused call throws a library error the server recognises'),
    refused instanceof server.NotificationException
  )
  check(
    label('the thrown error is push_send_failed, retryable, 503'),
    refused?.code === 'notification.push_send_failed' &&
      refused?.getResponse?.()?.error?.details?.retryable === true &&
      refused?.getStatus?.() === 503
  )

  const bare = scripted([{ status: 503, raw: 'gateway' }])
  const maybe = await new push.ExpoPushProvider({ fetch: bare.fetch }).send({
    tokens: GOOD,
    title: 'T',
    body: 'B'
  })
  check(
    label('a bare 503 is an answer: provider_unavailable, not retryable'),
    maybe.results[0]?.reason === 'provider_unavailable' && maybe.results[0]?.retryable === false
  )

  // The adapter's own copy of the input helpers throws the server's error class.
  const bad = await failureOf(
    new push.ExpoPushProvider({ fetch: ok.fetch }).send({ tokens: GOOD, title: 5, body: 'B' })
  )
  check(
    label("an input refusal thrown from the push bundle is the server's NotificationException"),
    bad instanceof server.NotificationException
  )
  check(
    label('and carries invalid_scope_identifier'),
    bad?.code === 'notification.invalid_scope_identifier'
  )

  // The ordering the docs ask for: the main entry first, then `./push`, then a key planted on the
  // realm root. The push bundle holds its own snapshot of the root, so the send through the push
  // provider must refuse; the key is removed again whatever happens.
  Object.defineProperty(Object.prototype, 'plantedByProbe', { value: 1, configurable: true })
  let planted
  try {
    planted = await failureOf(
      new push.ExpoPushProvider({ fetch: ok.fetch }).send({ tokens: GOOD, title: 'T', body: 'B' })
    )
  } finally {
    Reflect.deleteProperty(Object.prototype, 'plantedByProbe')
  }
  check(
    label('a key planted on the root after both entries loaded refuses the push send'),
    planted instanceof server.NotificationException
  )

  // Receipts.
  const receipts = scripted([{ body: { data: { t1: { status: 'ok' } } } }])
  const read = await new push.ExpoPushProvider({ fetch: receipts.fetch }).fetchReceipts([
    't1',
    't9'
  ])
  check(
    label('receipts: ok and pending'),
    read[0]?.status === 'ok' && read[1]?.status === 'pending'
  )
}

// The adapter from `./push/fcm` against the built server: one send with a throwaway key and a
// scripted `fetch`, and an input refusal that must be the server's own error class.
async function runFcm(format, server, fcm) {
  const label = (text) => `${format} fcm: ${text}`
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  const urls = []
  const answers = [{ access_token: 'at', expires_in: 3600 }, { name: FCM_NAME }]
  const provider = new fcm.FcmPushProvider({
    projectId: 'demo-project',
    clientEmail: 'push@demo-project.iam.gserviceaccount.com',
    privateKey,
    fetch: async (url) => {
      urls.push(String(url))
      return new Response(JSON.stringify(answers.shift() ?? {}))
    }
  })
  const moduleRef = await Test.createTestingModule({
    imports: [server.BymaxNotificationModule.forRoot({ push: { provider } })]
  }).compile()
  const sent = await moduleRef
    .get(server.NotificationService)
    .getPush()
    .send({ tenantId: 'acme', tokens: 'device', title: 'T', body: 'B' })
  check(label('a token gets its message name'), sent.results[0]?.messageId === FCM_NAME)
  check(
    label('the exchange and the send went to the fixed URLs'),
    urls.join() ===
      'https://oauth2.googleapis.com/token,https://fcm.googleapis.com/v1/projects/demo-project/messages:send'
  )
  const bad = await failureOf(provider.send({ tokens: 'device', title: 5, body: 'B' }))
  check(
    label("an input refusal is the server's NotificationException"),
    bad instanceof server.NotificationException
  )
}

async function main() {
  await runFcm(
    'cjs',
    require('@bymax-one/nest-notification'),
    require('@bymax-one/nest-notification/push/fcm')
  )
  await runFcm(
    'esm',
    await import('@bymax-one/nest-notification'),
    await import('@bymax-one/nest-notification/push/fcm')
  )
  await run(
    'cjs',
    require('@bymax-one/nest-notification'),
    require('@bymax-one/nest-notification/push')
  )
  await run(
    'esm',
    await import('@bymax-one/nest-notification'),
    await import('@bymax-one/nest-notification/push')
  )
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`push dist probe failed: ${failures.join('; ')}`)
      process.exit(1)
    }
    console.log('push dist probe: every assertion held')
  })
  .catch((error) => {
    console.error(`push dist probe threw: ${error instanceof Error ? error.stack : error}`)
    process.exit(1)
  })
