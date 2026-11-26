import { defineConfig } from 'tsup'
import type { Options } from 'tsup'

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number]

// All optional/required peer dependencies are marked external so none of them is
// ever bundled into the published artifact — the library ships `dependencies: {}`
// and reaches every integration only through an interface or a reference adapter.
const PEER_EXTERNALS = [
  /^@nestjs\//,
  'reflect-metadata',
  // Required peer of @nestjs/common; the audit interceptor returns an Observable.
  'rxjs',
  /^rxjs\//,
  'ioredis',
  'resend',
  'nodemailer',
  // The package itself: the observability entry imports the server's tokens and exception through
  // its own name, so an install holds one copy of each, the one the services use.
  '@bymax-one/nest-notification',
  // The observability entry's optional peers: metrics, readiness and traces.
  /^@bymax-one\/nest-core/,
  'prom-client',
  /^@opentelemetry\//
]

// The push entry bundles the adapter and the helpers it reads input with, but not the library's
// error class: a second copy of `NotificationException` would make the services' `instanceof`
// answer `false` for an error the adapter throws. This plugin sends that one import to the main
// entry, through the package's own name (external, like the observability entry's imports).
const SHARED_ERROR_CLASS: EsbuildPlugin = {
  name: 'shared-error-class',
  setup(build) {
    build.onResolve({ filter: /(^|\/)errors\/notification-exception$/ }, () => ({
      path: '@bymax-one/nest-notification',
      external: true
    }))
  }
}

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
  },

  // Testing entry — helpers a consumer runs against their own implementations
  // of this library's extension points. Node-targeted like the server entry,
  // and imported by no runtime entry, so it never reaches a production bundle.
  {
    entry: { 'testing/index': 'src/testing/index.ts' },
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

  // Observability entry — metrics, readiness and spans, for a host that has the optional peers
  // (`@bymax-one/nest-core`, `prom-client`, `@opentelemetry/api`). Node-targeted, imported by no
  // runtime entry, so a host that does not use it never loads a byte of it.
  {
    entry: { 'observability/index': 'src/observability/index.ts' },
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

  // Push entry — the reference push adapters, for a host that wants one. The channel is in the
  // server entry; an adapter a host does not use costs it nothing.
  {
    entry: { 'push/index': 'src/push/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: PEER_EXTERNALS,
    esbuildPlugins: [SHARED_ERROR_CLASS],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  },

  // FCM entry — its own, so a host that does not send through FCM loads none of it. Built like
  // the push entry, error class included.
  {
    entry: { 'push/fcm/index': 'src/push/fcm/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
    outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
    external: PEER_EXTERNALS,
    esbuildPlugins: [SHARED_ERROR_CLASS],
    target: 'node24',
    clean: false,
    splitting: false,
    treeshake: true,
    sourcemap: false
  }
])
