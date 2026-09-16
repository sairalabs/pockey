import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react-dom'],
  // Keeps the provider importable from Next.js App Router server components. No `treeshake`
  // option: it routes the bundle through Rollup, which strips module-level directives
  // (esbuild still drops unused code).
  banner: { js: "'use client';" },
});
