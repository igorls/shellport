/**
 * ShellPort - Types & SeqQueue Tests
 *
 * Tests FrameType constants and SeqQueue ordering guarantees.
 */

import { describe, test, expect } from 'bun:test'
import { SeqQueue, FrameType } from './types.js'

// ---------------------------------------------------------------------------
// FrameType constants
// ---------------------------------------------------------------------------
describe('FrameType', () => {
  test('core frame types have correct values', () => {
    expect(FrameType.DATA).toBe(0)
    expect(FrameType.CONTROL).toBe(1)
    expect(FrameType.SERVER_NONCE).toBe(2)
    expect(FrameType.CLIENT_NONCE).toBe(3)
    expect(FrameType.APPROVAL_REQUEST).toBe(4)
    expect(FrameType.APPROVAL_RESPONSE).toBe(5)
  })

  test('has all expected frame types', () => {
    const keys = Object.keys(FrameType)
    expect(keys).toContain('DATA')
    expect(keys).toContain('CONTROL')
    expect(keys).toContain('SERVER_NONCE')
    expect(keys).toContain('CLIENT_NONCE')
    expect(keys).toContain('APPROVAL_REQUEST')
    expect(keys).toContain('APPROVAL_RESPONSE')
  })
})

// ---------------------------------------------------------------------------
// SeqQueue
// ---------------------------------------------------------------------------
describe('SeqQueue', () => {
  test('executes tasks in FIFO order', async () => {
    const q = new SeqQueue()
    const results: number[] = []

    q.add(async () => {
      results.push(1)
    })
    q.add(async () => {
      results.push(2)
    })
    q.add(async () => {
      results.push(3)
    })

    // Wait for all tasks to drain
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(results).toEqual([1, 2, 3])
  })

  test('maintains order with varying async delays', async () => {
    const q = new SeqQueue()
    const results: string[] = []

    q.add(async () => {
      await new Promise((r) => setTimeout(r, 30))
      results.push('slow')
    })
    q.add(async () => {
      results.push('fast')
    })
    q.add(async () => {
      await new Promise((r) => setTimeout(r, 10))
      results.push('medium')
    })

    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(results).toEqual(['slow', 'fast', 'medium'])
  })

  test('continues execution after a failing task', async () => {
    const q = new SeqQueue()
    const results: string[] = []

    q.add(async () => {
      results.push('before')
    })
    q.add(async () => {
      throw new Error('boom')
    })
    q.add(async () => {
      results.push('after')
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(results).toEqual(['before', 'after'])
  })

  test('handles many queued tasks', async () => {
    const q = new SeqQueue()
    const results: number[] = []
    const N = 100

    for (let i = 0; i < N; i++) {
      q.add(async () => {
        results.push(i)
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(results.length).toBe(N)
    expect(results).toEqual(Array.from({ length: N }, (_, i) => i))
  })
})
