/**
 * ShellPort - Frontend HTML Builder
 *
 * Reads the frontend template and injects styles, crypto engine,
 * NanoTermV2 emulator, and app logic as inline content.
 * This produces a single self-contained HTML response.
 *
 * NanoTermV2 is developed as ES modules in nanoterm/ and bundled
 * into a single IIFE by Bun's bundler before inlining.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readFrontendFile(filename: string): string {
  return readFileSync(resolve(__dirname, filename), 'utf-8')
}

/**
 * True when the pre-built bundle is missing or any NanoTermV2 source is
 * newer than it — i.e. a render now would serve stale frontend code.
 * This catches the post-`git pull` case, where a checkout rewrites the
 * sources with fresh mtimes while the untracked bundle lingers on disk.
 */
export function isBundleStale(bundlePath: string, srcDir: string): boolean {
  if (!existsSync(bundlePath)) return true
  if (!existsSync(srcDir)) return false
  const bundleMtime = statSync(bundlePath).mtimeMs
  for (const name of readdirSync(srcDir)) {
    const file = resolve(srcDir, name)
    if (statSync(file).isFile() && statSync(file).mtimeMs > bundleMtime) return true
  }
  return false
}

/**
 * Bundle NanoTermV2 ES modules into a single IIFE script.
 * Skips if the output already exists and sources haven't changed.
 */
async function bundleNanoTerm(): Promise<void> {
  const entrypoint = resolve(__dirname, 'nanoterm/index.js')
  if (!existsSync(entrypoint)) return // Pre-bundled: skip
  if (!isBundleStale(resolve(__dirname, 'nanoterm.js'), resolve(__dirname, 'nanoterm'))) {
    return // Bundle is fresh: skip
  }

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: __dirname,
    naming: 'nanoterm.js',
    format: 'iife',
    minify: false,
    sourcemap: 'none',
    target: 'browser',
  })

  if (!result.success) {
    console.error('❌ NanoTerm bundle failed:')
    for (const log of result.logs) console.error(log)
    throw new Error('Frontend bundle failed')
  }
}

/**
 * Build the complete HTML client by injecting all frontend assets
 * into the HTML template.
 */
export async function buildHTML(cryptoJS: string): Promise<string> {
  await bundleNanoTerm()

  const template = readFrontendFile('index.html')
  const styles = readFrontendFile('styles.css')
  const nanoterm = readFrontendFile('nanoterm.js')
  const app = readFrontendFile('app.js')

  return template
    .replace('{{STYLES}}', styles)
    .replace('/*__CRYPTO_JS__*/', () => cryptoJS)
    .replace('/*__NANOTERM_JS__*/', () => nanoterm)
    .replace('/*__APP_JS__*/', () => app)
}
