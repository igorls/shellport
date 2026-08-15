/**
 * ShellPort - Frontend Bundle Freshness Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isBundleStale } from './build.js'

/** Write a file with a forced mtime so the test doesn't depend on wall clock. */
function touchAt(path: string, mtimeMs: number): void {
  const t = mtimeMs / 1000
  utimesSync(path, t, t)
}

describe('isBundleStale', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'shellport-build-'))
    mkdirSync(join(root, 'src'), { recursive: true })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('missing bundle is stale', () => {
    const bundle = join(root, 'bundle.js')
    const src = join(root, 'src')
    writeFileSync(join(src, 'index.js'), '/* v1 */')
    touchAt(join(src, 'index.js'), 2_000_000)
    expect(isBundleStale(bundle, src)).toBe(true)
  })

  test('bundle newer than all sources is fresh', () => {
    const bundle = join(root, 'bundle.js')
    const src = join(root, 'src')
    writeFileSync(join(src, 'index.js'), '/* v1 */')
    writeFileSync(join(src, 'helper.js'), '/* v1 */')
    touchAt(join(src, 'index.js'), 1_000_000)
    touchAt(join(src, 'helper.js'), 1_500_000)
    writeFileSync(bundle, '// bundled v1')
    touchAt(bundle, 2_000_000)
    expect(isBundleStale(bundle, src)).toBe(false)
  })

  test('any source newer than the bundle is stale (git-pull case)', () => {
    const bundle = join(root, 'bundle.js')
    const src = join(root, 'src')
    // A pull rewrites the sources with fresh mtimes; the untracked bundle lingers.
    writeFileSync(join(src, 'index.js'), '/* v2 */')
    writeFileSync(join(src, 'helper.js'), '/* v1 unchanged */')
    writeFileSync(join(src, 'extra.js'), '/* new file from the pull */')
    touchAt(join(src, 'index.js'), 3_000_000)
    touchAt(join(src, 'helper.js'), 1_500_000)
    touchAt(join(src, 'extra.js'), 2_500_000)
    writeFileSync(bundle, '// bundled v1')
    touchAt(bundle, 2_000_000)
    expect(isBundleStale(bundle, src)).toBe(true)
  })

  test('missing source dir is fresh (pre-bundled distribution)', () => {
    const bundle = join(root, 'bundle.js')
    writeFileSync(bundle, '// pre-bundled')
    touchAt(bundle, 2_000_000)
    expect(isBundleStale(bundle, join(root, 'does-not-exist'))).toBe(false)
  })
})
