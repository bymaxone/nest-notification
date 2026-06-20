import { defineConfig } from 'tsup'

// All optional/required peer dependencies are marked external so none of them is
// ever bundled into the published artifact — the library ships `dependencies: {}`
// and reaches every integration only through an interface or a reference adapter.
const PEER_EXTERNALS = [
  /^@nestjs\//,
  'reflect-metadata',
  'ioredis',
  'resend',
  '@sendgrid/mail',
  '@aws-sdk/client-ses',
  '@aws-sdk/client-sns',
  'mailgun.js',
  'nodemailer',
  'twilio',
  'firebase-admin',
  '@aws-sdk/client-dynamodb',
  'handlebars',
  '@react-email/render',
  'mjml',
  'class-validator',
  'class-transformer',
  'express'
]

export default defineConfig([
  // Server entry (main) — the NestJS dynamic module + reference providers.
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: PEER_EXTERNALS,
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // Shared entry — zero-dependency public types + constants importable from any
  // runtime (backend or frontend). No externals: it must stay self-contained.
  {
    entry: { 'shared/index': 'src/shared/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },
  // React entry — browser-targeted hooks. `react` stays external so the consumer
  // owns the single React instance; target es2022 because it runs in the browser.
  {
    entry: { 'react/index': 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: ['react'],
    target: 'es2022',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  }
])
