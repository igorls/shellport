/**
 * ShellPort - PTY Sanitization Tests
 */

import { describe, test, expect } from 'bun:test'
import { sanitizePTYData } from './server.js'
import { spawnPty } from './pty.js'

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

describe('PtySession', () => {
  test('launches an interactive command and exchanges terminal data', async () => {
    let output = ''
    const session = spawnPty(
      [
        process.execPath,
        '-e',
        "process.stdin.setEncoding('utf8'); process.stdin.once('data', value => { console.log('reply:' + value.trim()); process.exit(0) })",
      ],
      {
        cols: 40,
        rows: 10,
        onData: (data): void => {
          output += new TextDecoder().decode(data)
        },
      }
    )

    session.write('hello\r')
    await waitFor(() => output.includes('reply:hello'))
    await session.exited

    expect(output).toContain('reply:hello')
  })

  test.skipIf(process.platform === 'win32')(
    'propagates terminal resize events to the child process',
    async () => {
      let output = ''
      const decoder = new TextDecoder('utf-8', { fatal: false })
      // Size is reported from the stdout 'resize' event (SIGWINCH). Reading
      // columns from a stdin handler races that signal and can print the old size.
      const session = spawnPty(
        [
          process.execPath,
          '-e',
          "process.stdin.setEncoding('utf8'); process.stdout.on('resize', () => { console.log('resized:' + process.stdout.columns + 'x' + process.stdout.rows) }); console.log('ready:' + process.stdout.columns + 'x' + process.stdout.rows); process.stdin.once('data', () => process.exit(0)); setTimeout(() => process.exit(2), 8000)",
        ],
        {
          cols: 40,
          rows: 10,
          onData: (data): void => {
            output += decoder.decode(data, { stream: true })
          },
        }
      )

      await waitFor(() => output.includes('ready:40x10'))
      session.resize(100, 30)
      await waitFor(() => output.includes('resized:100x30'))
      session.write('report\r')
      await session.exited

      expect(output).toContain('resized:100x30')
    },
    15_000
  )

  test.skipIf(process.platform !== 'win32')(
    'runs a native Windows command through ConPTY',
    async () => {
      let output = ''
      const session = spawnPty(['cmd.exe', '/d', '/c', 'echo windows-conpty-ok'], {
        cols: 50,
        rows: 12,
        onData: (data): void => {
          output += new TextDecoder().decode(data)
        },
      })

      await session.exited

      expect(output).toContain('windows-conpty-ok')
    }
  )
})

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for PTY output')
    await Bun.sleep(10)
  }
}
