/**
 * ShellPort — HeadlessTerm, Soft-Wrap Reflow & Snapshot Tests
 */

import { describe, test, expect } from 'bun:test'
import { HeadlessTerm, findUrlAt, findUrlRangeAt, logicalRangeToSpans } from './vt.js'

describe('HeadlessTerm soft-wrap reflow', () => {
  test('unwraps and rewraps soft-wrapped logical lines losslessly across width changes', () => {
    const term = new HeadlessTerm(undefined, { cols: 20, rows: 6 })
    const longLine = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij' // 46 chars -> 3 rows at 20 cols
    term.write(`${longLine}\r\nPS C:\\repo> `)

    expect(term.dumpRow(0)).toBe('ABCDEFGHIJKLMNOPQRST')
    expect(term.dumpRow(1)).toBe('UVWXYZ0123456789abcd')
    expect(term.dumpRow(2)).toBe('efghij')
    expect(term.dumpRow(3)).toBe('PS C:\\repo>')
    expect(term.cursorX).toBe(12)
    expect(term.cursorY).toBe(3)

    // Shrink narrower: 20 -> 12 cols
    term.resize(12, 6)
    expect(term.readPlainText()).toBe(`${longLine}\nPS C:\\repo> `)

    // Expand wider: 12 -> 60 cols — all 46 chars reunite onto row 0!
    term.resize(60, 6)
    expect(term.dumpRow(0)).toBe(longLine)
    expect(term.dumpRow(1)).toBe('PS C:\\repo>')
    expect(term.cursorX).toBe(12)
    expect(term.cursorY).toBe(1)
  })

  test('preserves truecolor SGR attributes across narrow -> wide -> narrow reflow', () => {
    const term = new HeadlessTerm(undefined, { cols: 16, rows: 5 })
    term.write('\x1b[1;38;2;255;64;128mHELLO_COLORFUL_WORLD_12345\x1b[0m')

    term.resize(8, 5)
    term.resize(40, 5)

    const dump = term.dumpGrid()
    expect(dump.lines[0]).toBe('HELLO_COLORFUL_WORLD_12345')
    expect(dump.cells[0]?.fg).toBe('#ff4080')
    expect(dump.cells[0]?.bold).toBe(true)
    expect(dump.cells[25]?.char).toBe('5')
    expect(dump.cells[25]?.fg).toBe('#ff4080')
    expect(dump.cells[25]?.bold).toBe(true)
  })

  test('does not push active top prompt into scrollback when shrinking blank bottom viewport', () => {
    const term = new HeadlessTerm(undefined, { cols: 80, rows: 24 })
    term.write('PS C:\\work\\shell-project> ')

    expect(term.cursorY).toBe(0)
    expect(term.cursorX).toBe(26)

    // Shrink height from 24 -> 8: row 0 prompt stays on row 0, NOT pushed into scrollback!
    term.resize(80, 8)
    expect(term.scrollbackBuffer.length).toBe(0)
    expect(term.dumpRow(0)).toBe('PS C:\\work\\shell-project>')
    expect(term.cursorY).toBe(0)
    expect(term.cursorX).toBe(26)
  })

  test('pulls scrollback lines back onto screen when height grows', () => {
    const term = new HeadlessTerm(undefined, { cols: 40, rows: 4 })
    term.write('line-1\r\nline-2\r\nline-3\r\nline-4\r\nline-5\r\nline-6')

    expect(term.scrollbackBuffer.length).toBe(2)
    expect(term.dumpRow(0)).toBe('line-3')
    expect(term.dumpRow(3)).toBe('line-6')

    // Grow height to 8 rows: lines 1 and 2 pull back out of scrollback!
    term.resize(40, 8)
    expect(term.scrollbackBuffer.length).toBe(0)
    expect(term.dumpRow(0)).toBe('line-1')
    expect(term.dumpRow(5)).toBe('line-6')
    expect(term.cursorY).toBe(5)
    expect(term.cursorX).toBe(6)
  })

  test('preserves primary scrollback across alternate screen (vim/htop) transitions', () => {
    const term = new HeadlessTerm(undefined, { cols: 40, rows: 3 })
    term.write('hist-1\r\nhist-2\r\nhist-3\r\nprompt> ')
    expect(term.scrollbackBuffer.length).toBe(1)

    // Enter alt screen (DECSET 1049), draw TUI, then exit (DECRST 1049)
    term.write('\x1b[?1049h\x1b[1;1HTUI FULLSCREEN\x1b[?1049l')
    expect(term.useAlternate).toBe(false)
    expect(term.scrollbackBuffer.length).toBe(1)
    expect(term.dumpRow(2)).toBe('prompt>')
    expect(term.cursorX).toBe(8)
    expect(term.cursorY).toBe(2)
  })
})

describe('HeadlessTerm snapshots & query responder', () => {
  test('exportSnapshot and restoreSnapshot round-trip screen, scrollback, modes, colors, and title', () => {
    const src = new HeadlessTerm(undefined, { cols: 30, rows: 4 })
    src.write('\x1b]0;pwsh - project\x07')
    src.write('\x1b[?1h\x1b[?2004h')
    src.write('row-one\r\nrow-two\r\nrow-three\r\nrow-four\r\n')
    src.write('\x1b[38;2;10;200;120;4mactive> \x1b[0m')

    const snap = src.exportSnapshot()
    expect(snap.title).toBe('pwsh - project')
    expect(snap.applicationCursorKeys).toBe(true)
    expect(snap.bracketedPaste).toBe(true)
    expect(snap.scrollbackRows.length).toBeGreaterThan(0)

    const dst = new HeadlessTerm(undefined, { cols: 80, rows: 24 })
    let seenTitle = ''
    dst.onTitle = (t): void => {
      seenTitle = t
    }
    dst.restoreSnapshot(snap)

    expect(seenTitle).toBe('pwsh - project')
    expect(dst.cols).toBe(30)
    expect(dst.rows).toBe(4)
    expect(dst.applicationCursorKeys).toBe(true)
    expect(dst.bracketedPaste).toBe(true)
    expect(dst.cursorX).toBe(src.cursorX)
    expect(dst.cursorY).toBe(src.cursorY)
    expect(dst.readPlainText()).toBe(src.readPlainText())
    expect(dst.dumpGrid().cells[3 * 30]?.fg).toBe('#0ac878')
    expect(dst.dumpGrid().cells[3 * 30]?.underline).toBe(true)
  })

  test('answers DA1, DA2, DSR, and CPR when active, and stays silent in passiveQueries mode', () => {
    const serverReplies: string[] = []
    const active = new HeadlessTerm(
      (data) => {
        serverReplies.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      },
      { cols: 80, rows: 24 }
    )
    active.write('abc\x1b[c\x1b[>c\x1b[5n\x1b[6n')
    expect(serverReplies).toEqual(['\x1b[?62;22c', '\x1b[>0;10;1c', '\x1b[0n', '\x1b[1;4R'])

    const clientReplies: string[] = []
    const passive = new HeadlessTerm(
      (data) => {
        clientReplies.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      },
      { cols: 80, rows: 24, passiveQueries: true }
    )
    passive.write('abc\x1b[c\x1b[>c\x1b[5n\x1b[6n')
    expect(clientReplies).toEqual([])
  })
})

describe('HeadlessTerm links', () => {
  const url = 'https://example.com/a/very/long/path?query=1'

  test('logicalLineAt joins a URL soft-wrapped across rows', () => {
    const term = new HeadlessTerm(() => {}, { cols: 20, rows: 6 })
    term.write(`see ${url}.\r\n$ `)
    // The URL starts on row 0 and wraps onto rows 1 and 2.
    const line = term.logicalLineAt(2, 0)
    expect(line).not.toBeNull()
    expect(findUrlAt(line!.text, line!.index)).toBe(url)
    expect(findUrlAt(term.logicalLineAt(0, 1)!.text, term.logicalLineAt(0, 1)!.index)).toBeNull()
    // Trailing sentence punctuation is not part of the link.
    const dot = term.logicalLineAt(2, (4 + url.length) % 20)!
    expect(dot.text[dot.index]).toBe('.')
    expect(findUrlAt(dot.text, dot.index)).toBeNull()
  })

  test('logicalLineAt follows a scrolled-back viewport', () => {
    const term = new HeadlessTerm(() => {}, { cols: 40, rows: 3, scrollback: 50 })
    term.write(`${url}\r\n`)
    for (let i = 0; i < 5; i++) term.write(`line ${i}\r\n`)
    term.scrollbackOffset = term.scrollbackBuffer.length
    const line = term.logicalLineAt(0, 3)!
    expect(findUrlAt(line.text, line.index)).toBe(url)
  })

  test('a wrapped URL maps to one underline span per screen row', () => {
    const term = new HeadlessTerm(() => {}, { cols: 20, rows: 6 })
    term.write(`see ${url}.
$ `)
    const line = term.logicalLineAt(1, 3)!
    const link = findUrlRangeAt(line.text, line.index)!
    expect(link.url).toBe(url)
    // 'see ' is 4 cells, the URL is 44 cells: rows 0 (16), 1 (20), 2 (8).
    expect(logicalRangeToSpans(line, link.start, link.end, 6)).toEqual([
      { y: 0, x: 4, width: 16 },
      { y: 1, x: 0, width: 20 },
      { y: 2, x: 0, width: 8 },
    ])
    // Rows outside the viewport are clipped.
    expect(logicalRangeToSpans(line, link.start, link.end, 2)).toHaveLength(2)
  })

  test('findUrlAt only returns http(s) links', () => {
    expect(findUrlAt('open javascript:alert(1) now', 7)).toBeNull()
    expect(findUrlAt('(https://example.com/x)', 5)).toBe('https://example.com/x')
    expect(findUrlAt('a http://a.test b http://b.test', 20)).toBe('http://b.test/')
  })
})

describe('OSC string cancel', () => {
  test('ESC not followed by a backslash cancels an OSC instead of extending it', () => {
    const term = new HeadlessTerm(undefined, { cols: 20, rows: 2 })
    const writes: string[] = []
    ;(term as unknown as { handleOsc52Clipboard: (arg: string) => void }).handleOsc52Clipboard = (
      arg
    ) => {
      writes.push(arg)
    }
    term.write('\x1b]52;c;SGVsbG8=\x1bAQQ\\')
    expect(writes).toEqual([])
  })
})
