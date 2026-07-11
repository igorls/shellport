import { describe, expect, test } from 'bun:test'

import { toWebSocketPayload } from './client.js'

describe('ShellPort client transport', () => {
  test('copies packed bytes into a DOM WebSocket-compatible ArrayBuffer', () => {
    const source = new Uint8Array([0, 1, 2, 255])

    const payload = toWebSocketPayload(source)

    expect(payload).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(payload)]).toEqual([0, 1, 2, 255])
  })
})
