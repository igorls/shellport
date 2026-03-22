/**
 * ShellPort Frontend Bundler
 *
 * Bundles the NanoTermV2 ES module sources into a single IIFE script
 * that can be inlined into the HTML template by build.ts.
 *
 * Usage: bun run src/frontend/bundle.ts
 * Output: src/frontend/nanoterm.js
 */

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const result = await Bun.build({
  entrypoints: [resolve(__dirname, 'nanoterm/index.js')],
  outdir: resolve(__dirname),
  naming: 'nanoterm.js',
  format: 'iife',
  minify: false, // Keep readable for debugging; production minifies via --compile
  sourcemap: 'none',
  target: 'browser',
})

if (!result.success) {
  console.error('❌ Bundle failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log(`✅ Bundled nanoterm.js (${(result.outputs[0].size / 1024).toFixed(1)} KB)`)
