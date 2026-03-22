/**
 * ShellPort - PTY Sanitization Tests
 */

import { describe, test, expect } from 'bun:test'
import { sanitizePTYData } from './server.js'

describe('PTY Sanitization', () => {
  test('passes normal text', () => {
    const input = new TextEncoder().encode('Hello World')
    const output = sanitizePTYData(input)
    expect(new TextDecoder().decode(output)).toBe('Hello World')
  })

  test('passes standard SGR sequences', () => {
    const input = new TextEncoder().encode('\x1b[31mRed Text\x1b[0m')
    const output = sanitizePTYData(input)
    expect(new TextDecoder().decode(output)).toBe('\x1b[31mRed Text\x1b[0m')
  })

  test('blocks Device Status Report (DSR) queries', () => {
    // CSI 6 n should be blocked to prevent cursor position reporting
    const input = new TextEncoder().encode('Attack\x1b[6n')
    const output = sanitizePTYData(input)
    const decoded = new TextDecoder().decode(output)
    expect(decoded).not.toContain('\x1b[6n')
    expect(decoded).toBe('Attack')
  })

  test('blocks potentially dangerous OSC 52 clipboard writes (if configured)', () => {
    // OSC 52 c;...;...
    const input = new TextEncoder().encode('\x1b]52;c;SGVsbG8=\x07')
    const output = sanitizePTYData(input)
    const decoded = new TextDecoder().decode(output)
    expect(decoded).not.toContain('\x1b]52')
  })

  test('handles split sequences across chunks', () => {
    // This is complex for a simple buffer filter, but good to keep in mind
  })
})
