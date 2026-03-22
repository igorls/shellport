import { describe, test, expect, afterEach } from 'bun:test'
import { rateLimitMap, cleanupRateLimits, RATE_LIMIT_WINDOW_MS } from './server.js'

describe('Rate Limit Cleanup', () => {
  afterEach(() => {
    rateLimitMap.clear()
  })

  test('removes stale entries', () => {
    const now = Date.now()
    // Add an entry that is older than the window
    // Simulate a timestamp from > 60s ago
    const staleTime = now - RATE_LIMIT_WINDOW_MS - 1000
    rateLimitMap.set('10.0.0.1', [staleTime])

    // Add an entry that is within the window
    const freshTime = now - 1000
    rateLimitMap.set('10.0.0.2', [freshTime])

    cleanupRateLimits()

    expect(rateLimitMap.has('10.0.0.1')).toBe(false) // Should be removed
    expect(rateLimitMap.has('10.0.0.2')).toBe(true) // Should be kept
  })

  test('removes empty entries', () => {
    rateLimitMap.set('10.0.0.3', [])
    cleanupRateLimits()
    expect(rateLimitMap.has('10.0.0.3')).toBe(false)
  })

  test('keeps entries with at least one recent timestamp', () => {
    const now = Date.now()
    const staleTime = now - RATE_LIMIT_WINDOW_MS - 1000
    const freshTime = now - 1000

    // Even if some timestamps are old, if the last one is fresh, keep the entry.
    // (Individual timestamp pruning happens in checkRateLimit, this cleanup is for inactive IPs)
    rateLimitMap.set('10.0.0.4', [staleTime, freshTime])

    cleanupRateLimits()

    expect(rateLimitMap.has('10.0.0.4')).toBe(true)
  })
})
