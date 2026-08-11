import { describe, expect, test } from 'bun:test'
import { ATTR } from './constants.js'
import { NanoTermV2 } from './index.js'

function visibleText(input) {
  const term = Object.create(NanoTermV2.prototype)
  let output = ''
  term.parseState = 'ground'
  term.parseIntermediates = ''
  term.putChar = (char) => {
    output += char
  }

  for (const char of input) term.processChar(char, char.codePointAt(0) ?? 0)
  return output
}

describe('NanoTerm string control parsing', () => {
  test('consumes unsupported Kitty graphics APC payloads through ST', () => {
    const payload = '\x1b_Ga=d,d=i,i=1,q=2;AAAA\x1b\\after'
    expect(visibleText(payload)).toBe('after')
  })

  test('consumes PM and SOS payloads instead of displaying them', () => {
    expect(visibleText('\x1b^private message\x1b\\ok')).toBe('ok')
    expect(visibleText('\x1bXstart of string\x1b\\ok')).toBe('ok')
  })

  test('normalizes Claude Code faint compatibility styling without underline', () => {
    const term = Object.create(NanoTermV2.prototype)
    term.curFlags = 0
    term.curFg = 0
    term.curBg = 0
    term.processSGR([4, 2])
    expect(term.curFlags & ATTR.DIM).toBe(ATTR.DIM)
    expect(term.curFlags & ATTR.UNDERLINE).toBe(0)
  })
})

describe('NanoTerm Kitty keyboard protocol', () => {
  function keyboardTerm() {
    const sent = []
    const term = Object.create(NanoTermV2.prototype)
    term.useAlternate = false
    term.primaryKeyboardFlags = 0
    term.alternateKeyboardFlags = 0
    term.primaryKeyboardStack = []
    term.alternateKeyboardStack = []
    term.send = (value) => sent.push(value)
    term.cursorBlinkState = false
    return { term, sent }
  }

  test('advertises, sets, pushes and restores progressive enhancement flags', () => {
    const { term, sent } = keyboardTerm()
    term.executeKeyboardProtocol([31], '=')
    term.executeKeyboardProtocol([0], '?')
    expect(sent).toEqual(['\x1b[?31u'])

    term.executeKeyboardProtocol([8], '>')
    expect(term.keyboardFlags).toBe(8)
    term.executeKeyboardProtocol([1], '<')
    expect(term.keyboardFlags).toBe(31)
  })

  test('encodes Shift+Enter distinctly when all-key reporting is requested', () => {
    const { term, sent } = keyboardTerm()
    term.keyboardFlags = 8
    let prevented = false
    term.onKeyDown({
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
      preventDefault: () => {
        prevented = true
      },
    })
    expect(prevented).toBe(true)
    expect(sent).toEqual(['\x1b[13;2u'])
  })

  test('does not collapse modified Enter when an app requests disambiguation only', () => {
    const { term, sent } = keyboardTerm()
    term.keyboardFlags = 3
    term.onKeyDown({
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
      preventDefault() {},
    })
    expect(sent).toEqual(['\x1b[13;2u'])
  })

  test('keeps Kitty keyboard modes independent between screen buffers', () => {
    const { term } = keyboardTerm()
    term.keyboardFlags = 1
    term.useAlternate = true
    term.keyboardFlags = 31
    expect(term.keyboardFlags).toBe(31)
    term.useAlternate = false
    expect(term.keyboardFlags).toBe(1)
  })

  test('uses the physical Quote key code and preserves shifted quote text', () => {
    const { term } = keyboardTerm()
    term.keyboardFlags = 8 | 16
    const baseEvent = {
      code: 'Quote',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }
    expect(term.encodeKittyKey({ ...baseEvent, key: "'", shiftKey: false })).toBe('\x1b[39;1;39u')
    expect(term.encodeKittyKey({ ...baseEvent, key: '"', shiftKey: true })).toBe('\x1b[39;2;34u')
  })

  test('maps the macOS dead Quote key instead of dropping it on a canvas', () => {
    const { term, sent } = keyboardTerm()
    const baseEvent = {
      key: 'Dead',
      code: 'Quote',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
      preventDefault() {},
    }
    term.onKeyDown({ ...baseEvent, shiftKey: false })
    term.onKeyDown({ ...baseEvent, shiftKey: true })
    expect(sent).toEqual(["'", '"'])
  })
})
