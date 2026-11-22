#!/usr/bin/env node
// Finds the names Nodemailer (or Node, from the options Nodemailer builds) reads from instances and
// objects of their own, which no object the SMTP adapter hands over can shadow. For each property name
// the installed Nodemailer's sources mention it plants the name on Object.prototype, in a fresh process,
// with a string, a function, an array, an object, a number and a boolean, runs the built adapter against
// a local relay that speaks enough SMTP to take a message, and reports the names that changed the
// outcome or the transcript. Run it after `pnpm build` and whenever Nodemailer is updated, and add what
// it prints to `PROBED_KEYS` in `src/server/providers/nodemailer-keys.ts`.
//
//   node scripts/probe-nodemailer-internals.mjs
//
// A name already refused by the adapter (INTERNAL_KEYS) is skipped.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = join(ROOT, 'node_modules/nodemailer/dist/cjs')
const KINDS = ['str', 'fn', 'arr', 'obj', 'num', 'bool']
// Names of the language, the standard library and streams, which would only add noise.
const SKIP = new Set(
  '__proto__ constructor prototype hasOwnProperty toString valueOf isPrototypeOf propertyIsEnumerable toLocaleString then catch finally call apply bind length name message stack code push pop map forEach join split slice replace test match from assign keys entries values on once emit end write destroy pipe read toJSON return next throw done value'.split(
    ' '
  )
)

const sourcesUnder = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? sourcesUnder(path) : path.endsWith('.js') ? [path] : []
  })

const CHILD = `
require('reflect-metadata')
const lib = require(${JSON.stringify(join(ROOT, 'dist/server/index.cjs'))})
const net = require('node:net')
const [name, kind] = process.argv.slice(1)
const VALUES = { str: 'PLANTED', fn: function planted() { return {} }, arr: [], obj: {}, num: 1, bool: true }
const out = (text) => { console.log('OUT ' + text); process.exit(0) }
process.on('uncaughtException', (e) => out('uncaught ' + String(e && e.message).slice(0, 50)))
process.on('unhandledRejection', (e) => out('unhandled ' + String(e && e.message).slice(0, 50)))
const transcript = []
const server = net.createServer((socket) => {
  let body = false, buffer = ''
  socket.write('220 relay\\r\\n')
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    for (let i = buffer.indexOf('\\r\\n'); i >= 0; i = buffer.indexOf('\\r\\n')) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 2)
      if (body) { if (line === '.') { body = false; socket.write('250 queued\\r\\n') } else transcript.push('D ' + line.replace(/^(Date|Message-ID|X-Mailer):.*$/, '$1').replace(/_NmP-[0-9a-f]+/g, '_NmP-X')); continue }
      transcript.push('C ' + line.split(' ')[0] + (/^(MAIL|RCPT)/i.test(line) ? ' ' + line : ''))
      if (/^EHLO|^LHLO/i.test(line)) socket.write('250-relay\\r\\n250 AUTH PLAIN\\r\\n')
      else if (/^DATA/i.test(line)) { body = true; socket.write('354 go\\r\\n') }
      else if (/^QUIT/i.test(line)) { socket.write('221 bye\\r\\n'); socket.end() }
      else socket.write('250 ok\\r\\n')
    }
  })
})
server.listen(0, '127.0.0.1', async () => {
  const provider = new lib.SmtpEmailProvider({ host: '127.0.0.1', port: server.address().port })
  if (name !== '__base__') Object.defineProperty(Object.prototype, name, { value: VALUES[kind], configurable: true, writable: true })
  const timer = setTimeout(() => out('HANG'), 4000)
  let result
  try { await provider.send({ to: 'real@acme.com', from: 'noreply@acme.com', subject: 's', html: '<p>x</p>' }); result = 'OK' } catch (e) { result = 'ERR ' + String(e.message).replace(/\\d{4,5}/g, 'P').slice(0, 50) }
  clearTimeout(timer)
  setTimeout(() => out(result + ' ' + require('node:crypto').createHash('sha1').update(transcript.join('\\n')).digest('hex').slice(0, 10)), 150)
})
`

const run = (name, kind) => {
  const result = spawnSync(process.execPath, ['-e', CHILD, name, kind], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000
  })
  const line = result.stdout.split('\n').find((l) => l.startsWith('OUT'))
  return line ?? 'OUT TIMEOUT'
}

const mentioned = new Set()
for (const file of sourcesUnder(SOURCES)) {
  if (file.includes('well-known')) continue
  for (const match of readFileSync(file, 'utf8').matchAll(/\.([A-Za-z_]\w{1,40})\b/gu))
    mentioned.add(match[1])
}
const base = run('__base__', 'str')
const found = new Map()
for (const name of [...mentioned].sort()) {
  if (SKIP.has(name)) continue
  for (const kind of KINDS) {
    if (run(name, kind) !== base) {
      found.set(name, kind)
      break
    }
  }
}
console.log(
  `baseline: ${base}\n${found.size} names changed the outcome:\n${[...found.keys()].join(' ')}`
)
