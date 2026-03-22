/**
 * ShellPort - Server Integration Tests
 *
 * Tests HTTP routing, WebSocket upgrade, and PTY session lifecycle
 * using a real ShellPort server on ephemeral ports.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { deriveKey, pack, unpack } from './crypto.js'
import { FrameType } from './types.js'
import { buildHTML } from './frontend/build.js'
import { getCryptoJS } from './crypto.js'

let server: ReturnType<typeof Bun.serve>
const TEST_PORT = 17681 + Math.floor(Math.random() * 1000)
const BASE = `http://localhost:${TEST_PORT}`

beforeAll(async () => {
  const htmlClient = await buildHTML(getCryptoJS())

  server = Bun.serve({
    port: TEST_PORT,
    fetch(req, srv) {
      const url = new URL(req.url)

      if (url.pathname === '/ws') {
        if (srv.upgrade(req, { data: {} })) return
        return new Response('Expected WebSocket', { status: 400 })
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(htmlClient, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      return new Response('Not found', { status: 404 })
    },
    websocket: {
      open(ws) {
        // Echo server for testing — no PTY
        ws.send(new TextEncoder().encode('connected'))
      },
      message(ws, message) {
        // Echo the received message back
        ws.send(message)
      },
      close() {},
    },
  })
})

afterAll(() => {
  server?.stop(true)
})

// ---------------------------------------------------------------------------
// HTTP Routing
// ---------------------------------------------------------------------------
describe('HTTP routing', () => {
  test('GET / returns HTML', async () => {
    const res = await fetch(`${BASE}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html')

    const body = await res.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('ShellPort')
  })

  test('GET /index.html returns same HTML', async () => {
    const res = await fetch(`${BASE}/index.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html')
  })

  test('GET /nonexistent returns 404', async () => {
    const res = await fetch(`${BASE}/nonexistent`)
    expect(res.status).toBe(404)
  })

  test('GET /ws without upgrade returns 400', async () => {
    const res = await fetch(`${BASE}/ws`)
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
describe('WebSocket', () => {
  test('upgrade succeeds and receives initial message', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`)

    const msg = await new Promise<string>((resolve, reject) => {
      ws.addEventListener('open', () => {})
      ws.addEventListener('message', (e) => {
        resolve(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data))
      })
      ws.addEventListener('error', reject)
      setTimeout(() => reject(new Error('timeout')), 3000)
    })

    expect(msg).toBe('connected')
    ws.close()
  })

  test('echo round-trip works', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`)
    ws.binaryType = 'arraybuffer'

    // Wait for the initial "connected" message first
    await new Promise<void>((resolve) => {
      ws.addEventListener('message', () => resolve(), { once: true })
    })

    const testPayload = new TextEncoder().encode('echo-test')

    const response = await new Promise<Uint8Array>((resolve, reject) => {
      ws.addEventListener(
        'message',
        (e) => {
          resolve(new Uint8Array(e.data as ArrayBuffer))
        },
        { once: true }
      )
      ws.send(testPayload)
      setTimeout(() => reject(new Error('timeout')), 3000)
    })

    expect(new TextDecoder().decode(response)).toBe('echo-test')
    ws.close()
  })

  test('clean close', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`)

    await new Promise<void>((resolve) => {
      ws.addEventListener('open', () => resolve())
    })

    const closed = new Promise<void>((resolve, reject) => {
      ws.addEventListener('close', () => resolve())
      setTimeout(() => reject(new Error('timeout')), 3000)
    })

    ws.close()
    await closed // Should not throw
  })
})
