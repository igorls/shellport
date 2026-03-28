// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2: Feature-Complete VT100/VT220/xterm Emulator
// ═══════════════════════════════════════════════════════════════════════════

import {
  MAX_SEQUENCE_SIZE,
  XTERM_256_PALETTE,
  CELL_WORDS,
  CELL_CP_SHIFT,
  CELL_FLAGS_MASK,
  COLOR_DEFAULT,
  SPACE_CP,
  ATTR,
  XTERM_256_RGBA,
  rgbPack,
  DEC_SPECIAL_GRAPHICS,
} from './constants.js'
import { CanvasRenderer } from './canvas-renderer.js'
import { WebGLRenderer } from './webgl-renderer.js'

class NanoTermV2 {
  constructor(container, sendFn, options = {}) {
    this.container = container
    this.send = sendFn
    this.options = {
      fontSize: options.fontSize || 14,
      fontFamily:
        options.fontFamily ||
        "'JetBrains Mono Nerd Font', 'CaskaydiaCove Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: options.theme || {},
      scrollback: options.scrollback || 10000,
      cursorStyle: options.cursorStyle || 'block',
      cursorBlink: options.cursorBlink !== false,
      allowProprietary: options.allowProprietary !== false,
      padding: options.padding ?? 6,
      lineHeight: options.lineHeight || 0,
      renderer: options.renderer || 'auto', // 'auto' | 'canvas' | 'webgl'
    }

    // Theme colors
    const theme = this.options.theme
    this.colors = {
      background: theme.background || '#0a0a0a',
      foreground: theme.foreground || '#e0e0e0',
      cursor: theme.cursor || '#a78bfa',
      selection: theme.selection || 'rgba(167, 139, 250, 0.3)',
      palette: theme.palette || XTERM_256_PALETTE,
    }

    // Create renderer with auto-detection and fallback
    this.renderer = this._createRenderer(container)

    // Convenience aliases (backward compat + event binding)
    this.canvas = this.renderer.canvas

    // Terminal state
    this.cols = 80
    this.rows = 24
    this.charWidth = 0
    this.charHeight = 0

    // Primary and alternate buffers (flat Uint32Array grids)
    this.grid = null // Active grid (points to primary or alternate)
    this.primaryGrid = null // Primary screen grid
    this.useAlternate = false
    this.scrollbackBuffer = [] // Array of Uint32Array row snapshots
    this.scrollbackOffset = 0

    // Cursor state
    this.cursorX = 0
    this.cursorY = 0
    this.savedCursorX = 0
    this.savedCursorY = 0
    this.cursorVisible = true
    this.cursorBlinkState = true
    this.cursorBlinkTimer = null

    // Current attributes (RGBA truecolor, 0 = default)
    this.curFg = COLOR_DEFAULT
    this.curBg = COLOR_DEFAULT
    this.curFlags = 0
    this.savedFg = COLOR_DEFAULT
    this.savedBg = COLOR_DEFAULT
    this.savedFlags = 0

    // Scroll region
    this.scrollTop = 0
    this.scrollBottom = 0

    // Character set (DEC Special Graphics for tmux box-drawing)
    this.charsetG0 = 'B' // 'B' = US ASCII, '0' = DEC Special Graphics
    this.charsetG1 = '0'
    this.activeCharset = 0 // 0 = G0, 1 = G1

    // Tab stops
    this.tabStops = new Set()

    // Selection
    this.selection = null
    this.isSelecting = false
    this.selectionStart = null

    // Parser state
    this.parseState = 'ground'
    this.parseParams = []
    this.parseParam = ''
    this.parseIntermediates = ''
    this.oscBuffer = ''
    this.dcsBuffer = ''

    // Security: callback for clipboard write permission
    this.onClipboardWrite = null

    // Mouse tracking
    this.mouseTracking = 0
    this.mouseProtocol = 'normal'
    this.applicationCursorKeys = false

    // Bracketed paste
    this.bracketedPaste = false

    // Pending wrap state (VT100 phantom column / DECAWM)
    this.wrapPending = false

    // Focus state
    this.focused = false

    // UTF-8 decoder for streaming
    this.decoder = new TextDecoder('utf-8', { fatal: false })
    this.utf8Buffer = new Uint8Array(4)
    this.utf8BufferLen = 0

    // Rendering
    this.renderPending = false
    this._isDestroyed = false

    // Resize debounce
    this._resizeDebounceTimer = null

    // Callbacks
    this.onResize = null
    this.onTitle = null
    this.onFocus = null
    this.onBlur = null

    // Init
    this.measureChar()
    this.resetTerminal()
    this.setupEvents()
    this.startCursorBlink()
    this.canvas.focus()

    // Explicitly load the specified font and re-measure once available.
    // document.fonts.ready resolves immediately if no fonts are loading,
    // but document.fonts.load() forces the browser to load the exact font.
    if (document.fonts && document.fonts.load) {
      const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`
      document.fonts
        .load(fontSpec)
        .then(() => {
          if (this._isDestroyed) return // Prevent updating dead terminals
          this.measureChar()
          // Always resize after font load — even if charWidth didn't change,
          // data rendered with fallback font metrics needs to be repainted.
          // Bypass the debounce: this is a one-time correction, not a drag-resize.
          this.resize()
          if (this.onResize) {
            clearTimeout(this._resizeDebounceTimer)
            this.onResize(this.cols, this.rows)
          }
        })
        .catch(() => {
          /* font not available, fallback is fine */
        })
    }
  }

  // -------------------------------------------------------------------------
  // Renderer Factory
  // -------------------------------------------------------------------------

  _createRenderer(container) {
    const mode = this.options.renderer

    if (mode === 'webgl' || mode === 'auto') {
      try {
        const renderer = new WebGLRenderer(container, this.options, this.colors)
        // Listen for context lost — auto-fallback to Canvas2D
        renderer.canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          console.warn('[NanoTermV2] WebGL context lost — falling back to Canvas2D')
          this._switchRenderer(new CanvasRenderer(container, this.options, this.colors))
        })
        return renderer
      } catch (err) {
        console.warn(
          '[NanoTermV2] WebGL2 renderer failed, falling back to Canvas2D:',
          err.message,
          err
        )
        // Fall through to Canvas2D
      }
    }

    return new CanvasRenderer(container, this.options, this.colors)
  }

  _switchRenderer(newRenderer) {
    if (this._isDestroyed || !this.renderer) return

    // Don't log oldCanvas if we don't use it, just properly destroy
    this.renderer.destroy()
    this.renderer = newRenderer
    this.canvas = newRenderer.canvas

    // Hot-swap reinitialization
    this.measureChar()
    this.resize()
    this.setupEvents()
    this.startCursorBlink()
  }

  // -------------------------------------------------------------------------
  // Initialization Helpers
  // -------------------------------------------------------------------------

  measureChar() {
    this.renderer.measureChar()
    this.charWidth = this.renderer.charWidth
    this.charHeight = this.renderer.charHeight
  }

  resetTerminal() {
    this.cols = 80
    this.rows = 24
    this.cursorX = 0
    this.cursorY = 0
    this.wrapPending = false
    this.curFg = COLOR_DEFAULT
    this.curBg = COLOR_DEFAULT
    this.curFlags = 0
    this.scrollTop = 0
    this.scrollBottom = 0
    this.useAlternate = false
    this.scrollbackBuffer = []
    this.scrollbackOffset = 0
    this.selection = null
    this.primaryGrid = this.allocGrid(this.cols, this.rows)
    this.grid = this.primaryGrid
    this.tabStops.clear()
    for (let i = 0; i < this.cols; i += 8) {
      this.tabStops.add(i)
    }
    this.resize()
  }

  // ── Grid Helpers (Uint32Array) ──────────────────────────────────────────

  allocGrid(cols, rows) {
    const grid = new Uint32Array(cols * rows * CELL_WORDS)
    // Fill every cell with space + default colors
    const word0 = SPACE_CP << CELL_CP_SHIFT
    for (let i = 0; i < grid.length; i += CELL_WORDS) {
      grid[i] = word0
      // words 1,2,3 are 0 (COLOR_DEFAULT) — already zero-initialized
    }
    return grid
  }

  fillRow(y, cp, fg, bg, flags) {
    const offset = y * this.cols * CELL_WORDS
    const word0 = (cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK)
    for (let x = 0; x < this.cols; x++) {
      const off = offset + x * CELL_WORDS
      this.grid[off] = word0
      this.grid[off + 1] = fg
      this.grid[off + 2] = bg
      this.grid[off + 3] = 0
    }
  }

  fillRange(y, startX, endX, cp, fg, bg, flags) {
    const rowOffset = y * this.cols * CELL_WORDS
    const word0 = (cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK)
    for (let x = startX; x < endX && x < this.cols; x++) {
      const off = rowOffset + x * CELL_WORDS
      this.grid[off] = word0
      this.grid[off + 1] = fg
      this.grid[off + 2] = bg
      this.grid[off + 3] = 0
    }
  }

  extractRow(y) {
    const rowWords = this.cols * CELL_WORDS
    const offset = y * rowWords
    const row = new Uint32Array(rowWords)
    row.set(this.grid.subarray(offset, offset + rowWords))
    return row
  }

  // -------------------------------------------------------------------------
  // Resize Handling
  // -------------------------------------------------------------------------

  resize() {
    // Re-measure char dimensions (font may have loaded since last measure,
    // or container may have just become visible after display:none)
    this.measureChar()

    const rect = this.container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return // Prevent 1x1 scale when hidden

    const pad = this.options.padding

    const oldCols = this.cols
    const oldRows = this.rows
    const dpr = window.devicePixelRatio || 1

    this.cols = Math.max(1, Math.floor((rect.width - pad * 2) / this.charWidth))
    this.rows = Math.max(1, Math.floor((rect.height - pad * 2) / this.charHeight))

    if (
      this.cols === oldCols &&
      this.rows === oldRows &&
      this.canvas.width === rect.width * dpr &&
      this.canvas.height === rect.height * dpr
    ) {
      return // No dimension changes, skip expensive rebuild
    }

    this.scrollBottom = 0

    this.renderer.resizeCanvas(rect)
    this.renderer._renderCols = this.cols

    if (this.grid) {
      this.primaryGrid = this.resizeGrid(this.primaryGrid, oldCols, oldRows, true)
      if (this.useAlternate) {
        this.grid = this.resizeGrid(this.grid, oldCols, oldRows, false)
      } else {
        this.grid = this.primaryGrid
      }
    }

    this.tabStops.clear()
    for (let i = 0; i < this.cols; i += 8) {
      this.tabStops.add(i)
    }

    // Debounce the onResize callback to avoid flooding the PTY
    // during continuous drag-resize
    if (this.onResize) {
      clearTimeout(this._resizeDebounceTimer)
      this._resizeDebounceTimer = setTimeout(() => {
        this.onResize(this.cols, this.rows)
      }, 150)
    }

    this.triggerRender()
  }

  resizeGrid(oldGrid, oldCols, oldRows, isPrimary) {
    const newCols = this.cols
    const newRows = this.rows
    const newGrid = this.allocGrid(newCols, newRows)

    // Push excess rows to scrollback if shrinking
    let srcStartRow = 0
    if (oldRows > newRows) {
      const excess = oldRows - newRows
      if (isPrimary && !this.useAlternate) {
        for (let y = 0; y < excess; y++) {
          const rowWords = oldCols * CELL_WORDS
          const offset = y * rowWords
          const savedRow = new Uint32Array(rowWords)
          savedRow.set(oldGrid.subarray(offset, offset + rowWords))
          this.scrollbackBuffer.push(savedRow)
          if (this.scrollbackBuffer.length > this.options.scrollback) {
            this.scrollbackBuffer.shift()
          }
        }
      }
      srcStartRow = excess
    }

    // Copy existing data (memcpy per row via TypedArray.set)
    const copyRows = Math.min(oldRows - srcStartRow, newRows)
    const copyWords = Math.min(oldCols, newCols) * CELL_WORDS
    for (let y = 0; y < copyRows; y++) {
      const srcOff = (srcStartRow + y) * oldCols * CELL_WORDS
      const dstOff = y * newCols * CELL_WORDS
      newGrid.set(oldGrid.subarray(srcOff, srcOff + copyWords), dstOff)
    }

    return newGrid
  }

  // -------------------------------------------------------------------------
  // Parser - VT100/VT220/xterm Control Sequence Handler
  // -------------------------------------------------------------------------

  write(data) {
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data)
    }
    if (data instanceof Uint8Array) {
      this.processBytes(data)
    } else {
      this.processString(data)
    }
    this.triggerRender()
  }

  processBytes(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]
      if (this.utf8BufferLen > 0) {
        this.utf8Buffer[this.utf8BufferLen++] = byte
        const seqLen = this.utf8Buffer[0] < 0xe0 ? 2 : this.utf8Buffer[0] < 0xf0 ? 3 : 4
        if (this.utf8BufferLen >= seqLen) {
          const decoded = this.decoder.decode(this.utf8Buffer.slice(0, seqLen))
          this.processChar(decoded)
          this.utf8BufferLen = 0
        }
      } else if (byte >= 0x80) {
        this.utf8Buffer[0] = byte
        this.utf8BufferLen = 1
      } else {
        this.processChar(String.fromCharCode(byte))
      }
    }
  }

  processString(str) {
    for (let i = 0; i < str.length; i++) {
      this.processChar(str[i])
    }
  }

  processChar(c) {
    const code = c.charCodeAt(0)
    switch (this.parseState) {
      case 'ground':
        this.processGround(c, code)
        break
      case 'escape':
        this.processEscape(c, code)
        break
      case 'csi':
        this.processCSI(c, code)
        break
      case 'osc':
        this.processOSC(c, code)
        break
      case 'dcs':
        this.processDCS(c, code)
        break
      case 'charset':
        // ESC ( X or ESC ) X — select character set
        if (this.parseIntermediates === '(') this.charsetG0 = c
        else if (this.parseIntermediates === ')') this.charsetG1 = c
        this.parseState = 'ground'
        break
    }
  }

  processGround(c, code) {
    if (code === 0x1b) {
      this.parseState = 'escape'
      this.parseIntermediates = ''
    } else if (code === 0x0d) {
      this.cursorX = 0
      this.wrapPending = false
    } else if (code === 0x0a) {
      this.wrapPending = false
      this.lineFeed()
    } else if (code === 0x08) {
      this.wrapPending = false
      if (this.cursorX > 0) this.cursorX--
    } else if (code === 0x09) {
      this.wrapPending = false
      this.tabForward()
    } else if (code === 0x07) {
      // Bell
    } else if (code === 0x0e) {
      this.activeCharset = 1 // SO — shift to G1
    } else if (code === 0x0f) {
      this.activeCharset = 0 // SI — shift to G0
    } else if (code >= 0x20) {
      const cs = this.activeCharset === 0 ? this.charsetG0 : this.charsetG1
      this.putChar(cs === '0' && DEC_SPECIAL_GRAPHICS[c] ? DEC_SPECIAL_GRAPHICS[c] : c)
    }
  }

  processEscape(c, code) {
    if (c === '[') {
      this.parseState = 'csi'
      this.parseParams = []
      this.parseParam = ''
      this.parseIntermediates = ''
    } else if (c === ']') {
      this.parseState = 'osc'
      this.oscBuffer = ''
    } else if (c === 'P') {
      this.parseState = 'dcs'
      this.dcsBuffer = ''
    } else if (c === 'M') {
      this.reverseIndex()
      this.parseState = 'ground'
    } else if (c === 'D') {
      this.lineFeed()
      this.parseState = 'ground'
    } else if (c === 'E') {
      this.cursorX = 0
      this.lineFeed()
      this.parseState = 'ground'
    } else if (c === '7') {
      this.savedCursorX = this.cursorX
      this.savedCursorY = this.cursorY
      this.savedFg = this.curFg
      this.savedBg = this.curBg
      this.savedFlags = this.curFlags
      this.parseState = 'ground'
    } else if (c === '8') {
      this.cursorX = this.savedCursorX
      this.cursorY = this.savedCursorY
      this.wrapPending = false
      this.curFg = this.savedFg
      this.curBg = this.savedBg
      this.curFlags = this.savedFlags
      this.parseState = 'ground'
    } else if (c === 'c') {
      this.resetTerminal()
      this.parseState = 'ground'
    } else if (c === '(' || c === ')' || c === '*' || c === '+') {
      this.parseState = 'charset'
      this.parseIntermediates = c
    } else if (c === '>' || c === '=') {
      this.parseState = 'ground'
    } else {
      this.parseState = 'ground'
    }
  }

  processCSI(c, code) {
    if (code >= 0x30 && code <= 0x39) {
      this.parseParam += c
    } else if (code === 0x3b) {
      this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0)
      this.parseParam = ''
    } else if (code >= 0x3c && code <= 0x3f) {
      this.parseIntermediates = c
    } else if (code >= 0x20 && code <= 0x2f) {
      this.parseIntermediates += c
    } else if (code >= 0x40 && code <= 0x7e) {
      this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0)
      this.executeCSI(c, this.parseParams, this.parseIntermediates)
      this.parseState = 'ground'
    } else {
      this.parseState = 'ground'
    }
  }

  processOSC(c, code) {
    if (code === 0x07 || (code === 0x5c && this.parseIntermediates === '\\')) {
      this.executeOSC(this.oscBuffer)
      this.parseState = 'ground'
    } else if (code === 0x1b) {
      this.parseIntermediates = '\\'
    } else {
      // Security: limit OSC buffer size to prevent memory exhaustion
      if (this.oscBuffer.length < MAX_SEQUENCE_SIZE) {
        this.oscBuffer += c
      }
    }
  }

  processDCS(c, code) {
    if (code === 0x1b) {
      this.parseIntermediates = '\\'
    } else if (code === 0x5c && this.parseIntermediates === '\\') {
      this.executeDCS(this.dcsBuffer)
      this.parseState = 'ground'
    } else {
      // Security: limit DCS buffer size to prevent memory exhaustion
      if (this.dcsBuffer.length < MAX_SEQUENCE_SIZE) {
        this.dcsBuffer += c
      }
    }
  }

  // -------------------------------------------------------------------------
  // CSI Command Execution
  // -------------------------------------------------------------------------

  executeCSI(cmd, params, intermediates) {
    const p = params.map((v) => v || 0)
    const priv = intermediates.includes('?')

    switch (cmd) {
      // All cursor movement sequences clear the pending wrap state
      case 'A':
        this.wrapPending = false
        this.cursorY = Math.max(this.getScrollTop(), this.cursorY - (p[0] || 1))
        break
      case 'B':
        this.wrapPending = false
        this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + (p[0] || 1))
        break
      case 'C':
        this.wrapPending = false
        this.cursorX = Math.min(this.cols - 1, this.cursorX + (p[0] || 1))
        break
      case 'D':
        this.wrapPending = false
        this.cursorX = Math.max(0, this.cursorX - (p[0] || 1))
        break
      case 'E':
        this.wrapPending = false
        this.cursorX = 0
        this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + (p[0] || 1))
        break
      case 'F':
        this.wrapPending = false
        this.cursorX = 0
        this.cursorY = Math.max(this.getScrollTop(), this.cursorY - (p[0] || 1))
        break
      case 'G':
        this.wrapPending = false
        this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[0] || 1) - 1))
        break
      case 'H':
      case 'f':
        this.wrapPending = false
        this.cursorY = Math.max(0, Math.min(this.rows - 1, (p[0] || 1) - 1))
        this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[1] || 1) - 1))
        break
      case 'J':
        this.eraseDisplay(p[0] || 0)
        break
      case 'K':
        this.eraseLine(p[0] || 0)
        break
      case 'L':
        this.insertLines(p[0] || 1)
        break
      case 'M':
        this.deleteLines(p[0] || 1)
        break
      case 'P':
        this.deleteChars(p[0] || 1)
        break
      case '@':
        this.insertChars(p[0] || 1)
        break
      case 'X':
        this.eraseChars(p[0] || 1)
        break
      case 'r':
        if (!priv) {
          const top = (p[0] || 1) - 1
          const bottom = p[1] ? p[1] - 1 : this.rows - 1
          this.scrollTop = Math.max(0, Math.min(top, this.rows - 1))
          this.scrollBottom = Math.max(this.scrollTop, Math.min(bottom, this.rows - 1))
          this.cursorX = 0
          this.cursorY = 0
          this.wrapPending = false
        }
        break
      case 's':
        this.savedCursorX = this.cursorX
        this.savedCursorY = this.cursorY
        break
      case 'u':
        this.cursorX = this.savedCursorX
        this.cursorY = this.savedCursorY
        this.wrapPending = false
        break
      case 'S':
        this.scrollUp(p[0] || 1)
        break
      case 'T':
        this.scrollDown(p[0] || 1)
        break
      case 'd':
        this.wrapPending = false
        this.cursorY = Math.max(0, Math.min(this.rows - 1, (p[0] || 1) - 1))
        break
      case 'm':
        this.processSGR(p)
        break
      case 'h':
        this.setMode(p, priv)
        break
      case 'l':
        this.resetMode(p, priv)
        break
      case 'n':
        this.deviceStatusReport(p[0] || 0)
        break
      case 'c':
        if (priv) {
          // DA response (\x1b[?...c) — consume silently, this is a response not a query
        } else if (intermediates === '>') {
          // DA2 query — respond with device info
          this.send('\x1b[>0;10;1c')
        } else {
          // DA1 query — respond as VT220 with advanced features
          this.send('\x1b[?62;22c')
        }
        break
      case 'g':
        if (p[0] === 0) this.tabStops.delete(this.cursorX)
        else if (p[0] === 3) this.tabStops.clear()
        break
      case 'Z':
        this.tabBackward(p[0] || 1)
        break
      case 'I':
        this.tabForward(p[0] || 1)
        break
    }
  }

  // -------------------------------------------------------------------------
  // SGR (Select Graphic Rendition) - Color & Style
  // -------------------------------------------------------------------------

  processSGR(params) {
    if (params.length === 0) params = [0]

    for (let i = 0; i < params.length; i++) {
      const p = params[i]

      if (p === 0) {
        this.curFg = COLOR_DEFAULT
        this.curBg = COLOR_DEFAULT
        this.curFlags = 0
      } else if (p === 1) {
        this.curFlags |= ATTR.BOLD
      } else if (p === 2) {
        this.curFlags |= ATTR.DIM
      } else if (p === 3) {
        this.curFlags |= ATTR.ITALIC
      } else if (p === 4) {
        this.curFlags |= ATTR.UNDERLINE
      } else if (p === 5 || p === 6) {
        this.curFlags |= ATTR.BLINK
      } else if (p === 7) {
        this.curFlags |= ATTR.INVERSE
      } else if (p === 8) {
        this.curFlags |= ATTR.HIDDEN
      } else if (p === 9) {
        this.curFlags |= ATTR.STRIKETHROUGH
      } else if (p === 21) {
        this.curFlags |= ATTR.DOUBLE_UNDERLINE
      } else if (p === 22) {
        this.curFlags &= ~(ATTR.BOLD | ATTR.DIM)
      } else if (p === 23) {
        this.curFlags &= ~ATTR.ITALIC
      } else if (p === 24) {
        this.curFlags &= ~(ATTR.UNDERLINE | ATTR.DOUBLE_UNDERLINE)
      } else if (p === 25) {
        this.curFlags &= ~ATTR.BLINK
      } else if (p === 27) {
        this.curFlags &= ~ATTR.INVERSE
      } else if (p === 28) {
        this.curFlags &= ~ATTR.HIDDEN
      } else if (p === 29) {
        this.curFlags &= ~ATTR.STRIKETHROUGH
      } else if (p >= 30 && p <= 37) {
        this.curFg = XTERM_256_RGBA[p - 30]
      } else if (p === 38) {
        if (params[i + 1] === 5) {
          this.curFg = XTERM_256_RGBA[params[i + 2] || 0]
          i += 2
        } else if (params[i + 1] === 2) {
          this.curFg = rgbPack(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0)
          i += 4
        }
      } else if (p === 39) {
        this.curFg = COLOR_DEFAULT
      } else if (p >= 40 && p <= 47) {
        this.curBg = XTERM_256_RGBA[p - 40]
      } else if (p === 48) {
        if (params[i + 1] === 5) {
          this.curBg = XTERM_256_RGBA[params[i + 2] || 0]
          i += 2
        } else if (params[i + 1] === 2) {
          this.curBg = rgbPack(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0)
          i += 4
        }
      } else if (p === 49) {
        this.curBg = COLOR_DEFAULT
      } else if (p >= 90 && p <= 97) {
        this.curFg = XTERM_256_RGBA[p - 90 + 8]
      } else if (p >= 100 && p <= 107) {
        this.curBg = XTERM_256_RGBA[p - 100 + 8]
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mode Setting
  // -------------------------------------------------------------------------

  setMode(params, priv) {
    for (const p of params) {
      if (priv) {
        switch (p) {
          case 1:
            this.applicationCursorKeys = true
            break
          case 3:
            this.cols = 132
            this.clearScreen()
            if (this.onResize) this.onResize(this.cols, this.rows)
            break
          case 9:
            this.mouseTracking = 9
            break
          case 25:
            this.cursorVisible = true
            this.triggerRender()
            break
          case 47:
          case 1047:
            this.switchToAlternateBuffer()
            break
          case 1048:
            this.savedCursorX = this.cursorX
            this.savedCursorY = this.cursorY
            break
          case 1049:
            this.switchToAlternateBuffer()
            this.savedCursorX = this.cursorX
            this.savedCursorY = this.cursorY
            break
          case 1000:
            this.mouseTracking = 1000
            break
          case 1002:
            this.mouseTracking = 1002
            break
          case 1003:
            this.mouseTracking = 1003
            break
          case 1006:
            this.mouseProtocol = 'sgr'
            break
          case 2004:
            this.bracketedPaste = true
            break
        }
      }
    }
  }

  resetMode(params, priv) {
    for (const p of params) {
      if (priv) {
        switch (p) {
          case 1:
            this.applicationCursorKeys = false
            break
          case 3:
            this.cols = 80
            this.clearScreen()
            if (this.onResize) this.onResize(this.cols, this.rows)
            break
          case 9:
          case 1000:
          case 1002:
          case 1003:
            this.mouseTracking = 0
            break
          case 25:
            this.cursorVisible = false
            this.triggerRender()
            break
          case 47:
          case 1047:
          case 1049:
            this.switchToPrimaryBuffer()
            if (p === 1049) {
              this.cursorX = this.savedCursorX
              this.cursorY = this.savedCursorY
            }
            break
          case 1006:
            this.mouseProtocol = 'normal'
            break
          case 2004:
            this.bracketedPaste = false
            break
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // OSC & DCS Handlers
  // -------------------------------------------------------------------------

  executeOSC(data) {
    // Security: limit parsed data size
    if (data.length > MAX_SEQUENCE_SIZE) return

    const semiIndex = data.indexOf(';')
    if (semiIndex === -1) return

    const cmd = data.slice(0, semiIndex)
    const arg = data.slice(semiIndex + 1)

    switch (cmd) {
      case '0':
      case '2':
        if (this.onTitle) this.onTitle(arg)
        break
      case '52':
        // OSC 52: Clipboard operations - require user confirmation for writes
        if (arg.startsWith('c;')) {
          try {
            const text = atob(arg.slice(2))
            // Security: prompt user before allowing clipboard write
            if (this.onClipboardWrite) {
              if (this.onClipboardWrite(text)) {
                navigator.clipboard.writeText(text).catch(() => {})
              }
            } else {
              // Default: allow with console warning
              console.warn(
                '[ShellPort] OSC 52 clipboard write requested - consider setting onClipboardWrite callback'
              )
              navigator.clipboard.writeText(text).catch(() => {})
            }
          } catch {}
        }
        break
    }
  }

  executeDCS(data) {
    // DCS sequences — minimal implementation
  }

  // -------------------------------------------------------------------------
  // Buffer Management
  // -------------------------------------------------------------------------

  switchToAlternateBuffer() {
    if (!this.useAlternate) {
      this.primaryGrid = this.grid
      this.grid = this.allocGrid(this.cols, this.rows)
      this.useAlternate = true
      this.scrollbackBuffer = []
      this.scrollbackOffset = 0
    }
  }

  switchToPrimaryBuffer() {
    if (this.useAlternate) {
      this.grid = this.primaryGrid
      this.useAlternate = false
      this.scrollbackBuffer = []
      this.scrollbackOffset = 0
    }
  }

  getScrollTop() {
    return this.scrollTop || 0
  }
  getScrollBottom() {
    return this.scrollBottom || this.rows - 1
  }

  // -------------------------------------------------------------------------
  // Terminal Operations
  // -------------------------------------------------------------------------

  putChar(c) {
    // VT100 DECAWM: if a previous putChar set wrapPending,
    // execute the deferred line wrap before writing this character
    if (this.wrapPending) {
      this.cursorX = 0
      this.lineFeed()
      this.wrapPending = false
    }

    if (
      this.cursorY >= 0 &&
      this.cursorY < this.rows &&
      this.cursorX >= 0 &&
      this.cursorX < this.cols
    ) {
      const off = (this.cursorY * this.cols + this.cursorX) * CELL_WORDS
      this.grid[off] = (c.codePointAt(0) << CELL_CP_SHIFT) | (this.curFlags & CELL_FLAGS_MASK)
      this.grid[off + 1] = this.curFg
      this.grid[off + 2] = this.curBg
      this.grid[off + 3] = 0
    }

    if (this.cursorX >= this.cols - 1) {
      // Cursor stays at last column; wrap is deferred until next putChar
      this.wrapPending = true
    } else {
      this.cursorX++
    }
  }

  lineFeed() {
    const scrollBottom = this.getScrollBottom()
    if (this.cursorY >= scrollBottom) {
      this.scrollUp(1)
    } else {
      this.cursorY++
    }
  }

  reverseIndex() {
    const scrollTop = this.getScrollTop()
    if (this.cursorY <= scrollTop) {
      this.scrollDown(1)
    } else {
      this.cursorY--
    }
  }

  scrollUp(n = 1) {
    const scrollTop = this.getScrollTop()
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      // Save top row to scrollback (if in primary buffer)
      if (!this.useAlternate) {
        this.scrollbackBuffer.push(this.extractRow(scrollTop))
        if (this.scrollbackBuffer.length > this.options.scrollback) {
          this.scrollbackBuffer.shift()
        }
      }
      // Shift region up by one row (native memcpy via copyWithin)
      const srcStart = (scrollTop + 1) * rowWords
      const dstStart = scrollTop * rowWords
      const len = (scrollBottom - scrollTop) * rowWords
      this.grid.copyWithin(dstStart, srcStart, srcStart + len)
      // Fill bottom row (BCE)
      this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0)
    }
  }

  scrollDown(n = 1) {
    const scrollTop = this.getScrollTop()
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      // Shift region down by one row
      const srcStart = scrollTop * rowWords
      const len = (scrollBottom - scrollTop) * rowWords
      this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len)
      // Fill top row (BCE)
      this.fillRow(scrollTop, SPACE_CP, this.curFg, this.curBg, 0)
    }
  }

  eraseDisplay(mode) {
    switch (mode) {
      case 0:
        this.eraseLine(0)
        for (let y = this.cursorY + 1; y < this.rows; y++) {
          this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0)
        }
        break
      case 1:
        this.eraseLine(1)
        for (let y = 0; y < this.cursorY; y++) {
          this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0)
        }
        break
      case 2:
      case 3:
        for (let y = 0; y < this.rows; y++) {
          this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0)
        }
        if (mode === 3 && !this.useAlternate) {
          this.scrollbackBuffer = []
          this.scrollbackOffset = 0
        }
        break
    }
  }

  eraseLine(mode) {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    switch (mode) {
      case 0:
        this.fillRange(this.cursorY, this.cursorX, this.cols, SPACE_CP, this.curFg, this.curBg, 0)
        break
      case 1:
        this.fillRange(this.cursorY, 0, this.cursorX + 1, SPACE_CP, this.curFg, this.curBg, 0)
        break
      case 2:
        this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0)
        break
    }
  }

  eraseChars(n) {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    this.fillRange(
      this.cursorY,
      this.cursorX,
      this.cursorX + n,
      SPACE_CP,
      this.curFg,
      this.curBg,
      0
    )
  }

  insertChars(n) {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    const rowOffset = this.cursorY * this.cols * CELL_WORDS
    const srcStart = rowOffset + this.cursorX * CELL_WORDS
    const dstStart = srcStart + n * CELL_WORDS
    const rowEnd = rowOffset + this.cols * CELL_WORDS
    // Shift right (copyWithin handles overlapping correctly)
    this.grid.copyWithin(dstStart, srcStart, rowEnd - n * CELL_WORDS)
    // Fill inserted positions with BCE
    this.fillRange(
      this.cursorY,
      this.cursorX,
      Math.min(this.cursorX + n, this.cols),
      SPACE_CP,
      this.curFg,
      this.curBg,
      0
    )
  }

  deleteChars(n) {
    if (this.cursorY < 0 || this.cursorY >= this.rows) return
    const rowOffset = this.cursorY * this.cols * CELL_WORDS
    const srcStart = rowOffset + (this.cursorX + n) * CELL_WORDS
    const dstStart = rowOffset + this.cursorX * CELL_WORDS
    const rowEnd = rowOffset + this.cols * CELL_WORDS
    // Shift left
    this.grid.copyWithin(dstStart, srcStart, rowEnd)
    // Fill tail with BCE
    this.fillRange(this.cursorY, this.cols - n, this.cols, SPACE_CP, this.curFg, this.curBg, 0)
  }

  insertLines(n) {
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      if (this.cursorY <= scrollBottom) {
        // Shift rows down from cursorY to scrollBottom-1
        const srcStart = this.cursorY * rowWords
        const len = (scrollBottom - this.cursorY) * rowWords
        this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len)
        // Insert empty row at cursorY (BCE)
        this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0)
      }
    }
  }

  deleteLines(n) {
    const scrollBottom = this.getScrollBottom()
    const rowWords = this.cols * CELL_WORDS
    for (let i = 0; i < n; i++) {
      if (this.cursorY <= scrollBottom) {
        // Shift rows up from cursorY+1 to scrollBottom
        const srcStart = (this.cursorY + 1) * rowWords
        const dstStart = this.cursorY * rowWords
        const len = (scrollBottom - this.cursorY) * rowWords
        this.grid.copyWithin(dstStart, srcStart, srcStart + len)
        // Fill bottom row (BCE)
        this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0)
      }
    }
  }

  clearScreen() {
    for (let y = 0; y < this.rows; y++) {
      this.fillRow(y, SPACE_CP, COLOR_DEFAULT, COLOR_DEFAULT, 0)
    }
    this.cursorX = 0
    this.cursorY = 0
  }

  tabForward(n = 1) {
    for (let i = 0; i < n; i++) {
      let nextTab = this.cursorX + 1
      while (nextTab < this.cols && !this.tabStops.has(nextTab)) nextTab++
      this.cursorX = Math.min(nextTab, this.cols - 1)
    }
  }

  tabBackward(n = 1) {
    for (let i = 0; i < n; i++) {
      let prevTab = this.cursorX - 1
      while (prevTab > 0 && !this.tabStops.has(prevTab)) prevTab--
      this.cursorX = Math.max(0, prevTab)
    }
  }

  deviceStatusReport(cmd) {
    switch (cmd) {
      case 5:
        this.send('\x1b[0n')
        break
      case 6:
        this.send(`\x1b[${this.cursorY + 1};${this.cursorX + 1}R`)
        break
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  triggerRender() {
    if (!this.renderPending && !this._isDestroyed) {
      this.renderPending = true
      requestAnimationFrame(() => {
        if (!this._isDestroyed) this.render()
      })
    }
  }

  render() {
    this.renderPending = false
    this.renderer.render(this)
  }

  startCursorBlink() {
    if (!this.options.cursorBlink) return
    this.cursorBlinkTimer = setInterval(() => {
      this.cursorBlinkState = !this.cursorBlinkState
      this.triggerRender()
    }, 530)
  }

  stopCursorBlink() {
    if (this.cursorBlinkTimer) {
      clearInterval(this.cursorBlinkTimer)
      this.cursorBlinkTimer = null
    }
  }

  // -------------------------------------------------------------------------
  // Event Handling
  // -------------------------------------------------------------------------

  setupEvents() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
    }

    this.canvas.addEventListener('keydown', (e) => this.onKeyDown(e))
    this.canvas.addEventListener('keypress', (e) => this.onKeyPress(e))

    this.canvas.addEventListener('focus', () => {
      this.focused = true
      this.cursorBlinkState = true
      this.triggerRender()
      if (this.onFocus) this.onFocus()
    })

    this.canvas.addEventListener('blur', () => {
      this.focused = false
      this.triggerRender()
      if (this.onBlur) this.onBlur()
    })

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e))
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e))
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e))
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e))
    this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e))

    this._resizeObserver = new ResizeObserver(() => {
      if (!this._isDestroyed) this.resize()
    })
    this._resizeObserver.observe(this.container)

    this.canvas.addEventListener('paste', (e) => this.onPaste(e))
  }

  onKeyDown(e) {
    this.cursorBlinkState = true
    let seq = ''
    const modifier = (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0)

    // F1-F12: xterm escape sequences (codes 16 and 22 are skipped per spec)
    const FKEY_CODES = [
      null,
      'OP',
      'OQ',
      'OR',
      'OS',
      '[15~',
      '[17~',
      '[18~',
      '[19~',
      '[20~',
      '[21~',
      '[23~',
      '[24~',
    ]
    if (e.key.startsWith('F') && e.key.length <= 3) {
      const fnum = parseInt(e.key.slice(1))
      if (fnum >= 1 && fnum <= 12 && FKEY_CODES[fnum]) {
        if (fnum <= 4 && !modifier) {
          seq = '\x1b' + FKEY_CODES[fnum]
        } else if (fnum <= 4) {
          // F1-F4 with modifiers use CSI form
          seq = `\x1b[1;${modifier + 1}${FKEY_CODES[fnum][1]}`
        } else {
          const code = FKEY_CODES[fnum].slice(1, -1) // extract number from "[N~"
          seq = modifier ? `\x1b[${code};${modifier + 1}~` : '\x1b' + FKEY_CODES[fnum]
        }
      }
    } else {
      switch (e.key) {
        case 'Enter':
          seq = '\r'
          break
        case 'Backspace':
          seq = e.ctrlKey ? '\x08' : '\x7f'
          break
        case 'Tab':
          seq = e.shiftKey ? '\x1b[Z' : '\t'
          break
        case 'Escape':
          seq = '\x1b'
          break
        case 'ArrowUp':
          seq = modifier
            ? `\x1b[1;${modifier + 1}A`
            : this.applicationCursorKeys
              ? '\x1bOA'
              : '\x1b[A'
          break
        case 'ArrowDown':
          seq = modifier
            ? `\x1b[1;${modifier + 1}B`
            : this.applicationCursorKeys
              ? '\x1bOB'
              : '\x1b[B'
          break
        case 'ArrowRight':
          seq = modifier
            ? `\x1b[1;${modifier + 1}C`
            : this.applicationCursorKeys
              ? '\x1bOC'
              : '\x1b[C'
          break
        case 'ArrowLeft':
          seq = modifier
            ? `\x1b[1;${modifier + 1}D`
            : this.applicationCursorKeys
              ? '\x1bOD'
              : '\x1b[D'
          break
        case 'Home':
          seq = modifier ? `\x1b[1;${modifier + 1}H` : '\x1b[H'
          break
        case 'End':
          seq = modifier ? `\x1b[1;${modifier + 1}F` : '\x1b[F'
          break
        case 'Insert':
          seq = '\x1b[2~'
          break
        case 'Delete':
          seq = '\x1b[3~'
          break
        case 'PageUp':
          seq = '\x1b[5~'
          break
        case 'PageDown':
          seq = '\x1b[6~'
          break
        default:
          // Industry-standard clipboard: Ctrl+Shift+C always copies,
          // Ctrl+C copies when text is selected (otherwise sends ^C)
          if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
            if (e.shiftKey || this.selection) {
              e.preventDefault()
              this.copyToClipboard()
              if (!e.shiftKey) this.selection = null // clear selection after copy
              this.triggerRender()
              return
            }
            // No selection + no shift → send ^C
            seq = '\x03'
          } else if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
            // Ctrl+Shift+V: paste from clipboard
            e.preventDefault()
            navigator.clipboard
              .readText()
              .then((text) => {
                if (text) {
                  if (this.bracketedPaste) {
                    text = '\x1b[200~' + text + '\x1b[201~'
                  }
                  this.send(text)
                }
              })
              .catch(() => {})
            return
          } else if (e.ctrlKey && e.key.length === 1) {
            const code = e.key.toUpperCase().charCodeAt(0)
            if (code >= 64 && code <= 95) seq = String.fromCharCode(code - 64)
          }
          break
      }
    }

    if (seq) {
      e.preventDefault()
      this.send(seq)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Let keypress handle it
    } else {
      e.preventDefault()
    }
  }

  onKeyPress(e) {
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      this.send(e.key)
    }
  }

  onMouseDown(e) {
    if (this.mouseTracking && !e.shiftKey) {
      e.preventDefault()
      this.sendMouseReport(e, 'down')
    } else if (e.button === 0) {
      this.isSelecting = true
      this.selectionStart = this.screenToCell(e.clientX, e.clientY)
      this.selection = null // Don't create 0-width selection (traps Ctrl+C)
    }
    this.canvas.focus()
  }

  onMouseMove(e) {
    if (
      this.mouseTracking &&
      (this.mouseTracking === 1002 || this.mouseTracking === 1003) &&
      !e.shiftKey
    ) {
      if (this.mouseTracking === 1003 || e.buttons > 0) {
        this.sendMouseReport(e, e.buttons === 0 ? 'move' : 'drag')
      }
    } else if (this.isSelecting) {
      const cell = this.screenToCell(e.clientX, e.clientY)
      if (this.selectionStart) {
        if (
          cell.y < this.selectionStart.y ||
          (cell.y === this.selectionStart.y && cell.x < this.selectionStart.x)
        ) {
          this.selection = {
            startRow: cell.y,
            endRow: this.selectionStart.y,
            startCol: cell.x,
            endCol: this.selectionStart.x + 1,
          }
        } else {
          this.selection = {
            startRow: this.selectionStart.y,
            endRow: cell.y,
            startCol: this.selectionStart.x,
            endCol: cell.x + 1,
          }
        }
        this.triggerRender()
      }
    }
  }

  onMouseUp(e) {
    if (this.mouseTracking && !e.shiftKey) {
      e.preventDefault()
      this.sendMouseReport(e, 'up')
    } else if (e.button === 0) {
      this.isSelecting = false
    }
  }

  sendMouseReport(e, type, overrideButton) {
    const rect = this.canvas.getBoundingClientRect()
    const pad = this.options.padding ?? 6
    // Account for terminal padding — chars start after pad offset
    // Clamp to valid grid bounds [1, cols/rows]
    const x = Math.max(
      1,
      Math.min(this.cols, Math.floor((e.clientX - rect.left - pad) / this.charWidth) + 1)
    )
    const y = Math.max(
      1,
      Math.min(this.rows, Math.floor((e.clientY - rect.top - pad) / this.charHeight) + 1)
    )

    let button = overrideButton !== undefined ? overrideButton : e.button // 0=left, 1=middle, 2=right
    if (type === 'up') {
      // SGR protocol preserves original button ID — only legacy uses button=3
      button = this.mouseProtocol === 'sgr' ? button : 3
    } else if (type === 'move') {
      button = 35 // No button pressed — mode 1003 passive movement
    } else if (type === 'drag') {
      button = 32 + (e.buttons & 1 ? 0 : e.buttons & 2 ? 2 : e.buttons & 4 ? 1 : 0)
    }

    let mods = (e.shiftKey ? 4 : 0) + (e.altKey ? 8 : 0) + (e.ctrlKey ? 16 : 0)

    if (this.mouseProtocol === 'sgr') {
      const final = type === 'up' ? 'm' : 'M'
      this.send(`\x1b[<${button + mods};${x};${y}${final}`)
    } else {
      // Legacy X10: send raw bytes to avoid UTF-8 expansion for coords > 127
      const cb = button + mods + 32
      this.send(
        new Uint8Array([0x1b, 0x5b, 0x4d, cb, Math.min(255, x + 32), Math.min(255, y + 32)])
      )
    }
  }

  onWheel(e) {
    // Fix #5: Check mouseTracking first, independent of buffer mode
    if (this.mouseTracking) {
      e.preventDefault()
      // Fix #2: Pass scroll button as overrideButton — e.button is read-only on WheelEvent
      const scrollButton = e.deltaY > 0 ? 65 : 64 // 65=scroll-down, 64=scroll-up
      this.sendMouseReport(e, 'scroll', scrollButton)
    } else if (!this.useAlternate) {
      e.preventDefault()
      // Accumulate fractional deltas for smooth trackpad scrolling
      this._scrollAccum = (this._scrollAccum || 0) + e.deltaY
      const rows = Math.trunc(this._scrollAccum / this.charHeight)
      if (rows !== 0) {
        this._scrollAccum -= rows * this.charHeight
        // Positive deltaY = scroll down = move AWAY from history (subtract)
        this.scrollbackOffset = Math.max(
          0,
          Math.min(this.scrollbackBuffer.length, this.scrollbackOffset - rows)
        )
        this.triggerRender()
      }
    }
  }

  onContextMenu(e) {
    e.preventDefault()
    const menu = document.getElementById('context-menu')
    if (!menu) return // No context menu element available
    menu.style.left = e.clientX + 'px'
    menu.style.top = e.clientY + 'px'
    menu.classList.add('visible')
    const closeMenu = () => {
      menu.classList.remove('visible')
      document.removeEventListener('click', closeMenu)
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  }

  onPaste(e) {
    e.preventDefault()
    let text = e.clipboardData.getData('text/plain')
    if (this.bracketedPaste) {
      text = '\x1b[200~' + text + '\x1b[201~'
    }
    this.send(text)
  }

  screenToCell(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const pad = this.options.padding
    return {
      x: Math.max(
        0,
        Math.min(this.cols - 1, Math.floor((clientX - rect.left - pad) / this.charWidth))
      ),
      y: Math.max(
        0,
        Math.min(this.rows - 1, Math.floor((clientY - rect.top - pad) / this.charHeight))
      ),
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  getSelection() {
    if (!this.selection) return ''
    const { startRow, endRow, startCol, endCol } = this.selection
    const lines = []
    for (let y = startRow; y <= endRow; y++) {
      if (y < 0 || y >= this.rows) continue
      const sx = y === startRow ? startCol : 0
      const ex = y === endRow ? endCol : this.cols
      let line = ''
      for (let x = sx; x < ex; x++) {
        const off = (y * this.cols + x) * CELL_WORDS
        const cp = this.grid[off] >>> CELL_CP_SHIFT
        line += cp > 0 && cp !== SPACE_CP ? String.fromCodePoint(cp) : ' '
      }
      lines.push(line.trimEnd())
    }
    return lines.join('\n')
  }

  copyToClipboard() {
    const text = this.getSelection()
    if (text) navigator.clipboard.writeText(text).catch(() => {})
  }

  clear() {
    this.eraseDisplay(3)
    this.triggerRender()
  }

  /**
   * Live theme switching — updates colors without losing terminal state.
   * @param {Object} theme - Partial theme object (background, foreground, cursor, selection, palette)
   */
  setTheme(theme) {
    // Merge with existing colors
    if (theme.background) this.colors.background = theme.background
    if (theme.foreground) this.colors.foreground = theme.foreground
    if (theme.cursor) this.colors.cursor = theme.cursor
    if (theme.selection) this.colors.selection = theme.selection
    if (theme.palette) this.colors.palette = theme.palette

    // Propagate to renderer
    if (this.renderer && this.renderer.updateTheme) {
      this.renderer.updateTheme(this.colors)
    }

    this.triggerRender()
  }

  /**
   * Live font size change — re-measures and resizes without losing terminal state.
   * @param {number} size - New font size in pixels
   */
  setFontSize(size) {
    if (size === this.options.fontSize) return
    this.options.fontSize = size
    this.measureChar()
    this.resize()
  }

  destroy() {
    this._isDestroyed = true
    this.stopCursorBlink()
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }
    if (this.renderer && typeof this.renderer.destroy === 'function') {
      this.renderer.destroy()
      this.renderer = null
    } else if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
  }
}

// Expose globally for IIFE bundle and inline <script> usage
globalThis.NanoTermV2 = NanoTermV2
