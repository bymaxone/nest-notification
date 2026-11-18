/**
 * Probe run by the smoke test against the BUILT package, never against src: it wires the built
 * observability entry beside the built server entry, sends one email and issues and refuses one
 * code, and reads the samples from a real prom-client registry. It exists because the specs run on
 * src, where there is one copy of every token, and only the built bundles can show that the
 * observability bundle and the server bundle share them. Exit code 0 means every assertion held.
 *
 * Run from inside the package root (so the package name resolves to the package under test) with
 * NODE_PATH pointing at a node_modules that holds the optional peers.
 */
'use strict'

require('reflect-metadata')
const { Test } = require('@nestjs/testing')
const { Registry } = require('prom-client')

const server = require('@bymax-one/nest-notification')
const observability = require('@bymax-one/nest-notification/observability')

const failures = []
const check = (label, ok) => {
  if (!ok) failures.push(label)
}

const relay = (configured) => ({
  name: 'relay',
  isConfigured: () => configured,
  send: async () => ({ messageId: 'm1' }),
  verify: async () => undefined
})

async function build(provider) {
  return Test.createTestingModule({
    imports: [
      server.BymaxNotificationModule.forRoot({
        email: { provider, defaultFrom: 'noreply@acme.com' },
        otp: { storage: new server.InMemoryOtpStorage(), resendCooldownSeconds: 0 }
      }),
      observability.NotificationObservabilityModule.register()
    ]
  }).compile()
}

async function main() {
  const moduleRef = await build(relay(true))
  const registry = new Registry()
  moduleRef.get(observability.NotificationMetrics).registerMetrics(registry)
  await moduleRef.get(server.EmailService).send({
    tenantId: 'acme',
    to: 'jane@acme.com',
    subject: 'Hello',
    html: '<p>Hello</p>'
  })
  const otp = moduleRef.get(server.OtpService)
  const scope = { tenantId: 'acme', recipient: 'jane@acme.com', purpose: 'email_verification' }
  await otp.generate({ ...scope, deliverVia: 'manual' })
  await otp.verify({ ...scope, code: 'wrong' })
  const text = await registry.metrics()
  const has = (line) => text.split('\n').includes(line)
  check(
    'a send is counted',
    has('bymax_notification_messages_total{channel="email",outcome="sent"} 1')
  )
  check('a send is timed', has('bymax_notification_send_duration_seconds_count{channel="email"} 1'))
  check('an issued code is counted', has('bymax_notification_otp_total{event="issued"} 1'))
  check('a refused code is counted', has('bymax_notification_otp_total{event="failed"} 1'))
  check(
    'the observer token is the one the services read',
    moduleRef.get(server.BYMAX_NOTIFICATION_OBSERVER) !== undefined
  )
  await moduleRef.close()

  const down = await build(relay(false))
  const answer = await down.get(observability.NotificationHealthIndicator).check()
  check('an unconfigured provider is down', JSON.stringify(answer) === '{"status":"down"}')
  await down.close()
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`observability dist probe failed: ${failures.join('; ')}`)
      process.exit(1)
    }
    console.log('observability dist probe: every assertion held')
  })
  .catch((error) => {
    console.error(
      `observability dist probe threw: ${error instanceof Error ? error.message : error}`
    )
    process.exit(2)
  })
