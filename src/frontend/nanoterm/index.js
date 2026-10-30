// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2: Feature-Complete VT100/VT220/xterm Emulator
// ═══════════════════════════════════════════════════════════════════════════

import { HeadlessTerm, findUrlRangeAt as defaultFindLinkAt, logicalRangeToSpans } from '../../vt.js'
import { XTERM_256_PALETTE, CELL_WORDS, CELL_CP_SHIFT, SPACE_CP } from './constants.js'
import { CanvasRenderer } from './canvas-renderer.js'
import { WebGLRenderer } from './webgl-renderer.js'

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '')

class NanoTermV2 extends HeadlessTerm {
  constructor(container, sendFn, options = {}) {
    super(sendFn, {
      cols: 80,
      rows: 24,
      scrollback: options.scrollback || 10000,
      passiveQueries: options.passiveQueries === true,
    })

    this.container = container
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
      autoFocus: options.autoFocus !== false,
      passiveQueries: options.passiveQueries === true,
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
    this.canvas = this.renderer.canvas

    this.charWidth = 0
    this.charHeight = 0

    // Cursor blink
    this.cursorBlinkState = true
    this.cursorBlinkTimer = null

    // Selection
    this.selection = null
    this.isSelecting = false
    this.selectionStart = null

    // Focus state
    this.focused = false

    // Rendering
    this.renderPending = false
    this.renderFallbackTimer = null
    this._isDestroyed = false

    // Resize debounce
    this._resizeDebounceTimer = null

    // Browser callbacks
    this.onFocus = null
    this.onBlur = null

    // Links: Ctrl+click (Cmd+click on macOS) opens the URL under the pointer.
    // `findLinkAt(text, index)` returns the link covering `text[index]` as
    // `{ url, start, end }` (hover-underlined) or a bare URL string (clickable
    // only), else null; `onOpenLink(url)` opens it. Hosts can replace either.
    this.findLinkAt = defaultFindLinkAt
    this.onOpenLink = (url) => {
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
    }

    // Init
    this.measureChar()
    this.resetTerminal()
    this.setupEvents()
    this.startCursorBlink()
    if (this.options.autoFocus) this.canvas.focus()

    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`
      document.fonts
        .load(fontSpec)
        .then(() => {
          if (this._isDestroyed) return
          this.measureChar(true)
          this.resize()
          this.triggerRender()
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
    const platform = navigator.userAgentData?.platform || navigator.platform || ''
    const isWindows = /win/i.test(platform)

    if (mode === 'webgl' || (mode === 'auto' && !isWindows)) {
      try {
        const renderer = new WebGLRenderer(container, this.options, this.colors)
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
      }
    }

    return new CanvasRenderer(container, this.options, this.colors)
  }

  _switchRenderer(newRenderer) {
    if (this._isDestroyed || !this.renderer) return

    this.renderer.destroy()
    this.renderer = newRenderer
    this.canvas = newRenderer.canvas

    this.measureChar()
    this.resize()
    this.setupEvents()
    this.startCursorBlink()
  }

  // -------------------------------------------------------------------------
  // Initialization & Resize
  // -------------------------------------------------------------------------

  measureChar(forceAtlasReset = false) {
    if (!this.renderer) return
    this.renderer.measureChar(forceAtlasReset)
    this.charWidth = this.renderer.charWidth
    this.charHeight = this.renderer.charHeight
  }

  resetTerminal() {
    this.resetTerminalState(80, 24)
    this.selection = null
    this.resize()
  }

  resize(explicitCols, explicitRows) {
    if (explicitCols !== undefined && explicitRows !== undefined) {
      this.resizeTerminalGrid(explicitCols, explicitRows)
      this.triggerRender()
      return
    }
    if (!this.container || !this.renderer) return

    this.measureChar()

    const rect = this.container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const pad = this.options.padding
    const dpr = window.devicePixelRatio || 1

    const targetCols = Math.max(1, Math.floor((rect.width - pad * 2) / this.charWidth))
    const targetRows = Math.max(1, Math.floor((rect.height - pad * 2) / this.charHeight))

    if (
      targetCols === this.cols &&
      targetRows === this.rows &&
      this.canvas.width === rect.width * dpr &&
      this.canvas.height === rect.height * dpr
    ) {
      this.triggerRender()
      return
    }

    this.renderer.resizeCanvas(rect)
    this.renderer._renderCols = targetCols
    this.resizeTerminalGrid(targetCols, targetRows)

    if (this.onResize) {
      clearTimeout(this._resizeDebounceTimer)
      this._resizeDebounceTimer = setTimeout(() => {
        if (!this._isDestroyed && this.onResize) {
          this.onResize(this.cols, this.rows)
        }
      }, 150)
    }

    this.triggerRender()
  }

  /** Resize the host element so the terminal has an exact cell grid. */
  resizeToGrid(cols, rows) {
    const targetCols = Math.max(1, Math.floor(Number(cols) || 1))
    const targetRows = Math.max(1, Math.floor(Number(rows) || 1))
    const pad = this.options.padding * 2
    this.container.style.width = this.charWidth * targetCols + pad + 'px'
    this.container.style.height = this.charHeight * targetRows + pad + 'px'
    this.resize()
  }

  /**
   * Restore a server-captured `TerminalSnapshot` and reflow to the active DOM
   * container dimensions if currently visible.
   */
  restoreSnapshot(snapshot) {
    this.selection = null
    super.restoreSnapshot(snapshot)
    this.resize()
    this.triggerRender()
  }

  handleOsc52Clipboard(arg) {
    if (arg.startsWith('c;')) {
      try {
        const text = atob(arg.slice(2))
        if (this.onClipboardWrite) {
          if (this.onClipboardWrite(text)) {
            navigator.clipboard.writeText(text).catch(() => {})
          }
        } else {
          console.warn(
            '[ShellPort] OSC 52 clipboard write requested - consider setting onClipboardWrite callback'
          )
          navigator.clipboard.writeText(text).catch(() => {})
        }
      } catch {
        /* ignore invalid base64 */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  triggerRender() {
    if (this._isDestroyed || !this.renderer) return

    if (this.renderFallbackTimer) clearTimeout(this.renderFallbackTimer)
    this.renderFallbackTimer = setTimeout(() => {
      this.renderFallbackTimer = null
      if (this.renderPending && !this._isDestroyed) this.render()
    }, 50)

    if (!this.renderPending) {
      this.renderPending = true
      requestAnimationFrame(() => {
        if (this.renderFallbackTimer) {
          clearTimeout(this.renderFallbackTimer)
          this.renderFallbackTimer = null
        }
        if (!this._isDestroyed) this.render()
      })
    }
  }

  render() {
    if (this.renderFallbackTimer) {
      clearTimeout(this.renderFallbackTimer)
      this.renderFallbackTimer = null
    }
    this.renderPending = false
    if (this.renderer) {
      this.renderer.render(this)
    }
    if (this._pointer) this.updateLinkHover(this._pointer)
  }

  startCursorBlink() {
    if (!this.options.cursorBlink) return
    this.stopCursorBlink()
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
    const trackModifier = (e) => {
      if (this._pointer && (e.key === 'Control' || e.key === 'Meta')) {
        this._pointer = { ...this._pointer, ctrlKey: e.ctrlKey, metaKey: e.metaKey }
        this.updateLinkHover(this._pointer)
      }
    }
    this.canvas.addEventListener('keydown', trackModifier)
    this.canvas.addEventListener('keyup', trackModifier)
    this.canvas.addEventListener('mouseleave', () => {
      this._pointer = null
      this.updateLinkHover(null)
    })

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
          seq = `\x1b[1;${modifier + 1}${FKEY_CODES[fnum][1]}`
        } else {
          const code = FKEY_CODES[fnum].slice(1, -1)
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
          if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
            if (e.shiftKey || this.selection) {
              e.preventDefault()
              this.copyToClipboard()
              if (!e.shiftKey) this.selection = null
              this.triggerRender()
              return
            }
            seq = '\x03'
          } else if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
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

  /** URL under a mouse event's cell, when the link modifier is held. */
  linkAtPointer(e) {
    if (!this.findLinkAt) return null
    const cell = this.screenToCell(e.clientX, e.clientY)
    const line = this.logicalLineAt(cell.y, cell.x)
    const found = line ? this.findLinkAt(line.text, line.index) : null
    if (!found) return null
    // Hooks may return a bare URL (clickable, no underline) or `{ url, start, end }`.
    return typeof found === 'string'
      ? { url: found, start: -1, end: -1, line }
      : { url: found.url, start: found.start, end: found.end, line }
  }

  /**
   * Hover feedback for links: an underline drawn in a DOM overlay above the
   * canvas (the renderers are untouched), a tooltip, and the hand cursor while
   * the open modifier is held. Re-run after every render, so it follows output,
   * scrolling and resizes while the pointer rests.
   */
  updateLinkHover(pointer) {
    const link = pointer && !pointer.buttons ? this.linkAtPointer(pointer) : null
    this.canvas.style.cursor = link && (pointer.ctrlKey || pointer.metaKey) ? 'pointer' : ''
    const key = link
      ? `${link.url}|${link.start}|${link.line.rows[0]?.screenY}|${link.line.rows.length}|${this.cols}`
      : ''
    if (key === this._linkHoverKey) return
    this._linkHoverKey = key
    this.canvas.title = link ? `${link.url}\n${IS_MAC ? 'Cmd' : 'Ctrl'}+click to open` : ''
    this.drawLinkOverlay(link)
  }

  drawLinkOverlay(link) {
    if (!link || link.start < 0) {
      this._linkOverlay?.replaceChildren()
      return
    }
    if (!this._linkOverlay) {
      this._linkOverlay = document.createElement('div')
      this._linkOverlay.className = 'term-link-overlay'
      Object.assign(this._linkOverlay.style, {
        position: 'absolute',
        width: '0',
        height: '0',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: '1',
      })
      this.container.appendChild(this._linkOverlay)
    }
    // Same containing block as the canvas, so its offsets line the two up.
    this._linkOverlay.style.left = this.canvas.offsetLeft + 'px'
    this._linkOverlay.style.top = this.canvas.offsetTop + 'px'
    const pad = this.options.padding
    const spans = logicalRangeToSpans(link.line, link.start, link.end, this.rows)
    this._linkOverlay.replaceChildren(
      ...spans.map((span) => {
        const underline = document.createElement('div')
        Object.assign(underline.style, {
          position: 'absolute',
          left: pad + span.x * this.charWidth + 'px',
          top: pad + (span.y + 1) * this.charHeight - 2 + 'px',
          width: span.width * this.charWidth + 'px',
          height: '1px',
          background: this.colors.foreground,
        })
        return underline
      })
    )
  }

  onMouseDown(e) {
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      const link = this.linkAtPointer(e)
      if (link) {
        // Takes precedence over app mouse reporting and selection.
        e.preventDefault()
        this.onOpenLink?.(link.url)
        return
      }
    }
    if (this.mouseTracking && !e.shiftKey) {
      e.preventDefault()
      this.sendMouseReport(e, 'down')
    } else if (e.button === 0) {
      this.isSelecting = true
      this.selectionStart = this.screenToCell(e.clientX, e.clientY)
      this.selection = null
    }
    this.canvas.focus()
  }

  onMouseMove(e) {
    this._pointer = {
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      buttons: e.buttons,
    }
    this.updateLinkHover(this._pointer)
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
    const x = Math.max(
      1,
      Math.min(this.cols, Math.floor((e.clientX - rect.left - pad) / this.charWidth) + 1)
    )
    const y = Math.max(
      1,
      Math.min(this.rows, Math.floor((e.clientY - rect.top - pad) / this.charHeight) + 1)
    )

    let button = overrideButton !== undefined ? overrideButton : e.button
    if (type === 'up') {
      button = this.mouseProtocol === 'sgr' ? button : 3
    } else if (type === 'move') {
      button = 35
    } else if (type === 'drag') {
      button = 32 + (e.buttons & 1 ? 0 : e.buttons & 2 ? 2 : e.buttons & 4 ? 1 : 0)
    }

    const mods = (e.shiftKey ? 4 : 0) + (e.altKey ? 8 : 0) + (e.ctrlKey ? 16 : 0)

    if (this.mouseProtocol === 'sgr') {
      const final = type === 'up' ? 'm' : 'M'
      this.send(`\x1b[<${button + mods};${x};${y}${final}`)
    } else {
      const cb = button + mods + 32
      this.send(
        new Uint8Array([0x1b, 0x5b, 0x4d, cb, Math.min(255, x + 32), Math.min(255, y + 32)])
      )
    }
  }

  onWheel(e) {
    if (this.mouseTracking) {
      e.preventDefault()
      const scrollButton = e.deltaY > 0 ? 65 : 64
      this.sendMouseReport(e, 'scroll', scrollButton)
    } else if (!this.useAlternate) {
      e.preventDefault()
      this._scrollAccum = (this._scrollAccum || 0) + e.deltaY
      const rows = Math.trunc(this._scrollAccum / this.charHeight)
      if (rows !== 0) {
        this._scrollAccum -= rows * this.charHeight
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
    if (!menu) return
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

  setTheme(theme) {
    if (theme.background) this.colors.background = theme.background
    if (theme.foreground) this.colors.foreground = theme.foreground
    if (theme.cursor) this.colors.cursor = theme.cursor
    if (theme.selection) this.colors.selection = theme.selection
    if (theme.palette) this.colors.palette = theme.palette

    if (this.renderer && this.renderer.updateTheme) {
      this.renderer.updateTheme(this.colors)
    }

    this.triggerRender()
  }

  setFontSize(size) {
    if (size === this.options.fontSize) return
    this.options.fontSize = size
    this.measureChar()
    this.resize()
  }

  destroy() {
    this._isDestroyed = true
    if (this._resizeDebounceTimer) {
      clearTimeout(this._resizeDebounceTimer)
      this._resizeDebounceTimer = null
    }
    if (this.renderFallbackTimer) {
      clearTimeout(this.renderFallbackTimer)
      this.renderFallbackTimer = null
    }
    this.stopCursorBlink()
    this._pointer = null
    this._linkOverlay?.remove()
    this._linkOverlay = null
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
export { NanoTermV2 }
