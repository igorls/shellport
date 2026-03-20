# Directory Structure Report

This document contains files from the `/home/igorls/dev/GitHub/shellport/src/frontend/nanoterm` directory with extensions: js
Content hash: 109e7ae54f5ca379

## File Tree Structure

- 📄 canvas-renderer.js
- 📄 constants.js
- 📄 index.js
- 📄 webgl-renderer.js


### File: `index.js`

- Size: 53359 bytes
- Modified: 2026-03-20 21:33:20 UTC

```javascript
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
    rgbPack
} from './constants.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { WebGLRenderer } from './webgl-renderer.js';

class NanoTermV2 {
    constructor(container, sendFn, options = {}) {
        this.container = container;
        this.send = sendFn;
        this.options = {
            fontSize: options.fontSize || 14,
            fontFamily: options.fontFamily || "'JetBrains Mono Nerd Font', 'CaskaydiaCove Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            theme: options.theme || {},
            scrollback: options.scrollback || 10000,
            cursorStyle: options.cursorStyle || 'block',
            cursorBlink: options.cursorBlink !== false,
            allowProprietary: options.allowProprietary !== false,
            padding: options.padding ?? 6,
            lineHeight: options.lineHeight || 0,
            renderer: options.renderer || 'auto'  // 'auto' | 'canvas' | 'webgl'
        };

        // Theme colors
        const theme = this.options.theme;
        this.colors = {
            background: theme.background || '#0a0a0a',
            foreground: theme.foreground || '#e0e0e0',
            cursor: theme.cursor || '#a78bfa',
            selection: theme.selection || 'rgba(167, 139, 250, 0.3)',
            palette: theme.palette || XTERM_256_PALETTE
        };

        // Create renderer with auto-detection and fallback
        this.renderer = this._createRenderer(container);

        // Convenience aliases (backward compat + event binding)
        this.canvas = this.renderer.canvas;

        // Terminal state
        this.cols = 80;
        this.rows = 24;
        this.charWidth = 0;
        this.charHeight = 0;


        // Primary and alternate buffers (flat Uint32Array grids)
        this.grid = null;          // Active grid (points to primary or alternate)
        this.primaryGrid = null;   // Primary screen grid
        this.useAlternate = false;
        this.scrollbackBuffer = []; // Array of Uint32Array row snapshots
        this.scrollbackOffset = 0;

        // Cursor state
        this.cursorX = 0;
        this.cursorY = 0;
        this.savedCursorX = 0;
        this.savedCursorY = 0;
        this.cursorVisible = true;
        this.cursorBlinkState = true;
        this.cursorBlinkTimer = null;

        // Current attributes (RGBA truecolor, 0 = default)
        this.curFg = COLOR_DEFAULT;
        this.curBg = COLOR_DEFAULT;
        this.curFlags = 0;
        this.savedFg = COLOR_DEFAULT;
        this.savedBg = COLOR_DEFAULT;
        this.savedFlags = 0;

        // Scroll region
        this.scrollTop = 0;
        this.scrollBottom = 0;

        // Character set (DEC Special Graphics for tmux box-drawing)
        this.charsetG0 = 'B'; // 'B' = US ASCII, '0' = DEC Special Graphics
        this.charsetG1 = '0';
        this.activeCharset = 0; // 0 = G0, 1 = G1

        // Tab stops
        this.tabStops = new Set();

        // Selection
        this.selection = null;
        this.isSelecting = false;
        this.selectionStart = null;

        // Parser state
        this.parseState = 'ground';
        this.parseParams = [];
        this.parseParam = '';
        this.parseIntermediates = '';
        this.oscBuffer = '';
        this.dcsBuffer = '';

        // Security: callback for clipboard write permission
        this.onClipboardWrite = null;

        // Mouse tracking
        this.mouseTracking = 0;
        this.mouseProtocol = 'normal';

        // Bracketed paste
        this.bracketedPaste = false;

        // Pending wrap state (VT100 phantom column / DECAWM)
        this.wrapPending = false;

        // Focus state
        this.focused = false;

        // UTF-8 decoder for streaming
        this.decoder = new TextDecoder('utf-8', { fatal: false });
        this.utf8Buffer = new Uint8Array(4);
        this.utf8BufferLen = 0;

        // Rendering
        this.renderPending = false;

        // Resize debounce
        this._resizeDebounceTimer = null;

        // Callbacks
        this.onResize = null;
        this.onTitle = null;
        this.onFocus = null;
        this.onBlur = null;

        // Init
        this.measureChar();
        this.resetTerminal();
        this.setupEvents();
        this.startCursorBlink();
        this.canvas.focus();

        // Explicitly load the specified font and re-measure once available.
        // document.fonts.ready resolves immediately if no fonts are loading,
        // but document.fonts.load() forces the browser to load the exact font.
        if (document.fonts && document.fonts.load) {
            const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`;
            document.fonts.load(fontSpec).then(() => {
                this.measureChar();
                // Always resize after font load — even if charWidth didn't change,
                // data rendered with fallback font metrics needs to be repainted.
                // Bypass the debounce: this is a one-time correction, not a drag-resize.
                this.resize();
                if (this.onResize) {
                    clearTimeout(this._resizeDebounceTimer);
                    this.onResize(this.cols, this.rows);
                }
            }).catch(() => { /* font not available, fallback is fine */ });
        }
    }

    // -------------------------------------------------------------------------
    // Renderer Factory
    // -------------------------------------------------------------------------

    _createRenderer(container) {
        const mode = this.options.renderer;

        if (mode === 'webgl' || mode === 'auto') {
            try {
                const renderer = new WebGLRenderer(container, this.options, this.colors);
                // Listen for context lost — auto-fallback to Canvas2D
                renderer.canvas.addEventListener('webglcontextlost', (e) => {
                    e.preventDefault();
                    console.warn('[NanoTermV2] WebGL context lost — falling back to Canvas2D');
                    this._switchRenderer(new CanvasRenderer(container, this.options, this.colors));
                });
                return renderer;
            } catch (err) {
                console.warn('[NanoTermV2] WebGL2 renderer failed, falling back to Canvas2D:', err.message, err);
                // Fall through to Canvas2D
            }
        }

        return new CanvasRenderer(container, this.options, this.colors);
    }

    _switchRenderer(newRenderer) {
        const oldCanvas = this.renderer.canvas;
        this.renderer.destroy();
        this.renderer = newRenderer;
        this.canvas = newRenderer.canvas;
        this.measureChar();
        this.resize();
        // Re-bind event listeners on the new canvas
        this.setupEvents();
        this.startCursorBlink();
    }

    // -------------------------------------------------------------------------
    // Initialization Helpers
    // -------------------------------------------------------------------------

    measureChar() {
        this.renderer.measureChar();
        this.charWidth = this.renderer.charWidth;
        this.charHeight = this.renderer.charHeight;
    }

    resetTerminal() {
        this.cols = 80;
        this.rows = 24;
        this.cursorX = 0;
        this.cursorY = 0;
        this.wrapPending = false;
        this.curFg = COLOR_DEFAULT;
        this.curBg = COLOR_DEFAULT;
        this.curFlags = 0;
        this.scrollTop = 0;
        this.scrollBottom = 0;
        this.useAlternate = false;
        this.scrollbackBuffer = [];
        this.scrollbackOffset = 0;
        this.selection = null;
        this.primaryGrid = this.allocGrid(this.cols, this.rows);
        this.grid = this.primaryGrid;
        this.tabStops.clear();
        for (let i = 0; i < this.cols; i += 8) {
            this.tabStops.add(i);
        }
        this.resize();
    }

    // ── Grid Helpers (Uint32Array) ──────────────────────────────────────────

    allocGrid(cols, rows) {
        const grid = new Uint32Array(cols * rows * CELL_WORDS);
        // Fill every cell with space + default colors
        const word0 = SPACE_CP << CELL_CP_SHIFT;
        for (let i = 0; i < grid.length; i += CELL_WORDS) {
            grid[i] = word0;
            // words 1,2,3 are 0 (COLOR_DEFAULT) — already zero-initialized
        }
        return grid;
    }

    fillRow(y, cp, fg, bg, flags) {
        const offset = y * this.cols * CELL_WORDS;
        const word0 = (cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK);
        for (let x = 0; x < this.cols; x++) {
            const off = offset + x * CELL_WORDS;
            this.grid[off] = word0;
            this.grid[off + 1] = fg;
            this.grid[off + 2] = bg;
            this.grid[off + 3] = 0;
        }
    }

    fillRange(y, startX, endX, cp, fg, bg, flags) {
        const rowOffset = y * this.cols * CELL_WORDS;
        const word0 = (cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK);
        for (let x = startX; x < endX && x < this.cols; x++) {
            const off = rowOffset + x * CELL_WORDS;
            this.grid[off] = word0;
            this.grid[off + 1] = fg;
            this.grid[off + 2] = bg;
            this.grid[off + 3] = 0;
        }
    }

    extractRow(y) {
        const rowWords = this.cols * CELL_WORDS;
        const offset = y * rowWords;
        const row = new Uint32Array(rowWords);
        row.set(this.grid.subarray(offset, offset + rowWords));
        return row;
    }

    // -------------------------------------------------------------------------
    // Resize Handling
    // -------------------------------------------------------------------------

    resize() {
        // Re-measure char dimensions (font may have loaded since last measure,
        // or container may have just become visible after display:none)
        this.measureChar();

        const rect = this.container.getBoundingClientRect();

        const pad = this.options.padding;

        const oldCols = this.cols;
        const oldRows = this.rows;
        this.cols = Math.max(1, Math.floor((rect.width - pad * 2) / this.charWidth));
        this.rows = Math.max(1, Math.floor((rect.height - pad * 2) / this.charHeight));
        this.scrollBottom = 0;

        this.renderer.resizeCanvas(rect);
        this.renderer._renderCols = this.cols;

        if (this.grid) {
            this.primaryGrid = this.resizeGrid(this.primaryGrid, oldCols, oldRows, true);
            if (this.useAlternate) {
                this.grid = this.resizeGrid(this.grid, oldCols, oldRows, false);
            } else {
                this.grid = this.primaryGrid;
            }
        }

        this.tabStops.clear();
        for (let i = 0; i < this.cols; i += 8) {
            this.tabStops.add(i);
        }

        // Debounce the onResize callback to avoid flooding the PTY
        // during continuous drag-resize
        if (this.onResize) {
            clearTimeout(this._resizeDebounceTimer);
            this._resizeDebounceTimer = setTimeout(() => {
                this.onResize(this.cols, this.rows);
            }, 150);
        }

        this.triggerRender();
    }

    resizeGrid(oldGrid, oldCols, oldRows, isPrimary) {
        const newCols = this.cols;
        const newRows = this.rows;
        const newGrid = this.allocGrid(newCols, newRows);

        // Push excess rows to scrollback if shrinking
        let srcStartRow = 0;
        if (oldRows > newRows) {
            const excess = oldRows - newRows;
            if (isPrimary && !this.useAlternate) {
                for (let y = 0; y < excess; y++) {
                    const rowWords = oldCols * CELL_WORDS;
                    const offset = y * rowWords;
                    const savedRow = new Uint32Array(rowWords);
                    savedRow.set(oldGrid.subarray(offset, offset + rowWords));
                    this.scrollbackBuffer.push(savedRow);
                    if (this.scrollbackBuffer.length > this.options.scrollback) {
                        this.scrollbackBuffer.shift();
                    }
                }
            }
            srcStartRow = excess;
        }

        // Copy existing data (memcpy per row via TypedArray.set)
        const copyRows = Math.min(oldRows - srcStartRow, newRows);
        const copyWords = Math.min(oldCols, newCols) * CELL_WORDS;
        for (let y = 0; y < copyRows; y++) {
            const srcOff = (srcStartRow + y) * oldCols * CELL_WORDS;
            const dstOff = y * newCols * CELL_WORDS;
            newGrid.set(oldGrid.subarray(srcOff, srcOff + copyWords), dstOff);
        }

        return newGrid;
    }

    // -------------------------------------------------------------------------
    // Parser - VT100/VT220/xterm Control Sequence Handler
    // -------------------------------------------------------------------------

    write(data) {
        if (data instanceof ArrayBuffer) {
            data = new Uint8Array(data);
        }
        if (data instanceof Uint8Array) {
            this.processBytes(data);
        } else {
            this.processString(data);
        }
        this.triggerRender();
    }

    processBytes(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            if (this.utf8BufferLen > 0) {
                this.utf8Buffer[this.utf8BufferLen++] = byte;
                const seqLen = this.utf8Buffer[0] < 0xE0 ? 2 : (this.utf8Buffer[0] < 0xF0 ? 3 : 4);
                if (this.utf8BufferLen >= seqLen) {
                    const decoded = this.decoder.decode(this.utf8Buffer.slice(0, seqLen));
                    this.processChar(decoded);
                    this.utf8BufferLen = 0;
                }
            } else if (byte >= 0x80) {
                this.utf8Buffer[0] = byte;
                this.utf8BufferLen = 1;
            } else {
                this.processChar(String.fromCharCode(byte));
            }
        }
    }

    processString(str) {
        for (let i = 0; i < str.length; i++) {
            this.processChar(str[i]);
        }
    }

    processChar(c) {
        const code = c.charCodeAt(0);
        switch (this.parseState) {
            case 'ground': this.processGround(c, code); break;
            case 'escape': this.processEscape(c, code); break;
            case 'csi': this.processCSI(c, code); break;
            case 'osc': this.processOSC(c, code); break;
            case 'dcs': this.processDCS(c, code); break;
            case 'charset':
                // ESC ( X or ESC ) X — select character set
                if (this.parseIntermediates === '(') this.charsetG0 = c;
                else if (this.parseIntermediates === ')') this.charsetG1 = c;
                this.parseState = 'ground';
                break;
        }
    }

    processGround(c, code) {
        if (code === 0x1B) {
            this.parseState = 'escape';
            this.parseIntermediates = '';
        } else if (code === 0x0D) {
            this.cursorX = 0;
            this.wrapPending = false;
        } else if (code === 0x0A) {
            this.wrapPending = false;
            this.lineFeed();
        } else if (code === 0x08) {
            this.wrapPending = false;
            if (this.cursorX > 0) this.cursorX--;
        } else if (code === 0x09) {
            this.wrapPending = false;
            this.tabForward();
        } else if (code === 0x07) {
            // Bell
        } else if (code === 0x0E) {
            this.activeCharset = 1; // SO — shift to G1
        } else if (code === 0x0F) {
            this.activeCharset = 0; // SI — shift to G0
        } else if (code >= 0x20) {
            const cs = this.activeCharset === 0 ? this.charsetG0 : this.charsetG1;
            this.putChar(cs === '0' && DEC_SPECIAL_GRAPHICS[c] ? DEC_SPECIAL_GRAPHICS[c] : c);
        }
    }

    processEscape(c, code) {
        if (c === '[') {
            this.parseState = 'csi';
            this.parseParams = [];
            this.parseParam = '';
            this.parseIntermediates = '';
        } else if (c === ']') {
            this.parseState = 'osc';
            this.oscBuffer = '';
        } else if (c === 'P') {
            this.parseState = 'dcs';
            this.dcsBuffer = '';
        } else if (c === 'M') {
            this.reverseIndex();
            this.parseState = 'ground';
        } else if (c === 'D') {
            this.lineFeed();
            this.parseState = 'ground';
        } else if (c === 'E') {
            this.cursorX = 0;
            this.lineFeed();
            this.parseState = 'ground';
        } else if (c === '7') {
            this.savedCursorX = this.cursorX;
            this.savedCursorY = this.cursorY;
            this.savedFg = this.curFg;
            this.savedBg = this.curBg;
            this.savedFlags = this.curFlags;
            this.parseState = 'ground';
        } else if (c === '8') {
            this.cursorX = this.savedCursorX;
            this.cursorY = this.savedCursorY;
            this.wrapPending = false;
            this.curFg = this.savedFg;
            this.curBg = this.savedBg;
            this.curFlags = this.savedFlags;
            this.parseState = 'ground';
        } else if (c === 'c') {
            this.resetTerminal();
            this.parseState = 'ground';
        } else if (c === '(' || c === ')' || c === '*' || c === '+') {
            this.parseState = 'charset';
            this.parseIntermediates = c;
        } else if (c === '>' || c === '=') {
            this.parseState = 'ground';
        } else {
            this.parseState = 'ground';
        }
    }

    processCSI(c, code) {
        if (code >= 0x30 && code <= 0x39) {
            this.parseParam += c;
        } else if (code === 0x3B) {
            this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0);
            this.parseParam = '';
        } else if (code >= 0x3C && code <= 0x3F) {
            this.parseIntermediates = c;
        } else if (code >= 0x20 && code <= 0x2F) {
            this.parseIntermediates += c;
        } else if (code >= 0x40 && code <= 0x7E) {
            this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0);
            this.executeCSI(c, this.parseParams, this.parseIntermediates);
            this.parseState = 'ground';
        } else {
            this.parseState = 'ground';
        }
    }

    processOSC(c, code) {
        if (code === 0x07 || (code === 0x5C && this.parseIntermediates === '\\')) {
            this.executeOSC(this.oscBuffer);
            this.parseState = 'ground';
        } else if (code === 0x1B) {
            this.parseIntermediates = '\\';
        } else {
            // Security: limit OSC buffer size to prevent memory exhaustion
            if (this.oscBuffer.length < MAX_SEQUENCE_SIZE) {
                this.oscBuffer += c;
            }
        }
    }

    processDCS(c, code) {
        if (code === 0x1B) {
            this.parseIntermediates = '\\';
        } else if (code === 0x5C && this.parseIntermediates === '\\') {
            this.executeDCS(this.dcsBuffer);
            this.parseState = 'ground';
        } else {
            // Security: limit DCS buffer size to prevent memory exhaustion
            if (this.dcsBuffer.length < MAX_SEQUENCE_SIZE) {
                this.dcsBuffer += c;
            }
        }
    }

    // -------------------------------------------------------------------------
    // CSI Command Execution
    // -------------------------------------------------------------------------

    executeCSI(cmd, params, intermediates) {
        const p = params.map(v => v || 0);
        const priv = intermediates.includes('?');

        switch (cmd) {
            // All cursor movement sequences clear the pending wrap state
            case 'A': this.wrapPending = false; this.cursorY = Math.max(this.getScrollTop(), this.cursorY - (p[0] || 1)); break;
            case 'B': this.wrapPending = false; this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + (p[0] || 1)); break;
            case 'C': this.wrapPending = false; this.cursorX = Math.min(this.cols - 1, this.cursorX + (p[0] || 1)); break;
            case 'D': this.wrapPending = false; this.cursorX = Math.max(0, this.cursorX - (p[0] || 1)); break;
            case 'E':
                this.wrapPending = false;
                this.cursorX = 0;
                this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + (p[0] || 1));
                break;
            case 'F':
                this.wrapPending = false;
                this.cursorX = 0;
                this.cursorY = Math.max(this.getScrollTop(), this.cursorY - (p[0] || 1));
                break;
            case 'G': this.wrapPending = false; this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[0] || 1) - 1)); break;
            case 'H':
            case 'f':
                this.wrapPending = false;
                this.cursorY = Math.max(0, Math.min(this.rows - 1, (p[0] || 1) - 1));
                this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[1] || 1) - 1));
                break;
            case 'J': this.eraseDisplay(p[0] || 0); break;
            case 'K': this.eraseLine(p[0] || 0); break;
            case 'L': this.insertLines(p[0] || 1); break;
            case 'M': this.deleteLines(p[0] || 1); break;
            case 'P': this.deleteChars(p[0] || 1); break;
            case '@': this.insertChars(p[0] || 1); break;
            case 'X': this.eraseChars(p[0] || 1); break;
            case 'r':
                if (!priv) {
                    const top = (p[0] || 1) - 1;
                    const bottom = p[1] ? p[1] - 1 : this.rows - 1;
                    this.scrollTop = Math.max(0, Math.min(top, this.rows - 1));
                    this.scrollBottom = Math.max(this.scrollTop, Math.min(bottom, this.rows - 1));
                    this.cursorX = 0;
                    this.cursorY = 0;
                    this.wrapPending = false;
                }
                break;
            case 's':
                this.savedCursorX = this.cursorX;
                this.savedCursorY = this.cursorY;
                break;
            case 'u':
                this.cursorX = this.savedCursorX;
                this.cursorY = this.savedCursorY;
                this.wrapPending = false;
                break;
            case 'S': this.scrollUp(p[0] || 1); break;
            case 'T': this.scrollDown(p[0] || 1); break;
            case 'd': this.wrapPending = false; this.cursorY = Math.max(0, Math.min(this.rows - 1, (p[0] || 1) - 1)); break;
            case 'm': this.processSGR(p); break;
            case 'h': this.setMode(p, priv); break;
            case 'l': this.resetMode(p, priv); break;
            case 'n': this.deviceStatusReport(p[0] || 0); break;
            case 'c':
                if (priv) {
                    // DA response (\x1b[?...c) — consume silently, this is a response not a query
                } else if (intermediates === '>') {
                    // DA2 query — respond with device info
                    this.send('\x1b[>0;10;1c');
                } else {
                    // DA1 query — respond as VT220 with advanced features
                    this.send('\x1b[?62;22c');
                }
                break;
            case 'g':
                if (p[0] === 0) this.tabStops.delete(this.cursorX);
                else if (p[0] === 3) this.tabStops.clear();
                break;
            case 'Z': this.tabBackward(p[0] || 1); break;
            case 'I': this.tabForward(p[0] || 1); break;
        }
    }

    // -------------------------------------------------------------------------
    // SGR (Select Graphic Rendition) - Color & Style
    // -------------------------------------------------------------------------

    processSGR(params) {
        if (params.length === 0) params = [0];

        for (let i = 0; i < params.length; i++) {
            const p = params[i];

            if (p === 0) {
                this.curFg = COLOR_DEFAULT; this.curBg = COLOR_DEFAULT; this.curFlags = 0;
            } else if (p === 1) {
                this.curFlags |= ATTR.BOLD;
            } else if (p === 2) {
                this.curFlags |= ATTR.DIM;
            } else if (p === 3) {
                this.curFlags |= ATTR.ITALIC;
            } else if (p === 4) {
                this.curFlags |= ATTR.UNDERLINE;
            } else if (p === 5 || p === 6) {
                this.curFlags |= ATTR.BLINK;
            } else if (p === 7) {
                this.curFlags |= ATTR.INVERSE;
            } else if (p === 8) {
                this.curFlags |= ATTR.HIDDEN;
            } else if (p === 9) {
                this.curFlags |= ATTR.STRIKETHROUGH;
            } else if (p === 21) {
                this.curFlags |= ATTR.DOUBLE_UNDERLINE;
            } else if (p === 22) {
                this.curFlags &= ~(ATTR.BOLD | ATTR.DIM);
            } else if (p === 23) {
                this.curFlags &= ~ATTR.ITALIC;
            } else if (p === 24) {
                this.curFlags &= ~(ATTR.UNDERLINE | ATTR.DOUBLE_UNDERLINE);
            } else if (p === 25) {
                this.curFlags &= ~ATTR.BLINK;
            } else if (p === 27) {
                this.curFlags &= ~ATTR.INVERSE;
            } else if (p === 28) {
                this.curFlags &= ~ATTR.HIDDEN;
            } else if (p === 29) {
                this.curFlags &= ~ATTR.STRIKETHROUGH;
            } else if (p >= 30 && p <= 37) {
                this.curFg = XTERM_256_RGBA[p - 30];
            } else if (p === 38) {
                if (params[i + 1] === 5) {
                    this.curFg = XTERM_256_RGBA[params[i + 2] || 0]; i += 2;
                } else if (params[i + 1] === 2) {
                    this.curFg = rgbPack(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0); i += 4;
                }
            } else if (p === 39) {
                this.curFg = COLOR_DEFAULT;
            } else if (p >= 40 && p <= 47) {
                this.curBg = XTERM_256_RGBA[p - 40];
            } else if (p === 48) {
                if (params[i + 1] === 5) {
                    this.curBg = XTERM_256_RGBA[params[i + 2] || 0]; i += 2;
                } else if (params[i + 1] === 2) {
                    this.curBg = rgbPack(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0); i += 4;
                }
            } else if (p === 49) {
                this.curBg = COLOR_DEFAULT;
            } else if (p >= 90 && p <= 97) {
                this.curFg = XTERM_256_RGBA[p - 90 + 8];
            } else if (p >= 100 && p <= 107) {
                this.curBg = XTERM_256_RGBA[p - 100 + 8];
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
                    case 1: break;
                    case 3:
                        this.cols = 132;
                        this.clearScreen();
                        if (this.onResize) this.onResize(this.cols, this.rows);
                        break;
                    case 9: this.mouseTracking = 9; break;
                    case 25:
                        this.cursorVisible = true;
                        this.triggerRender();
                        break;
                    case 47:
                    case 1047:
                        this.switchToAlternateBuffer();
                        break;
                    case 1048:
                        this.savedCursorX = this.cursorX;
                        this.savedCursorY = this.cursorY;
                        break;
                    case 1049:
                        this.switchToAlternateBuffer();
                        this.savedCursorX = this.cursorX;
                        this.savedCursorY = this.cursorY;
                        break;
                    case 1000: this.mouseTracking = 1000; break;
                    case 1002: this.mouseTracking = 1002; break;
                    case 1006: this.mouseProtocol = 'sgr'; break;
                    case 2004: this.bracketedPaste = true; break;
                }
            }
        }
    }

    resetMode(params, priv) {
        for (const p of params) {
            if (priv) {
                switch (p) {
                    case 1: break;
                    case 3:
                        this.cols = 80;
                        this.clearScreen();
                        if (this.onResize) this.onResize(this.cols, this.rows);
                        break;
                    case 9:
                    case 1000:
                    case 1002:
                        this.mouseTracking = 0;
                        break;
                    case 25:
                        this.cursorVisible = false;
                        this.triggerRender();
                        break;
                    case 47:
                    case 1047:
                    case 1049:
                        this.switchToPrimaryBuffer();
                        if (p === 1049) {
                            this.cursorX = this.savedCursorX;
                            this.cursorY = this.savedCursorY;
                        }
                        break;
                    case 1006: this.mouseProtocol = 'normal'; break;
                    case 2004: this.bracketedPaste = false; break;
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // OSC & DCS Handlers
    // -------------------------------------------------------------------------

    executeOSC(data) {
        // Security: limit parsed data size
        if (data.length > MAX_SEQUENCE_SIZE) return;
        
        const semiIndex = data.indexOf(';');
        if (semiIndex === -1) return;

        const cmd = data.slice(0, semiIndex);
        const arg = data.slice(semiIndex + 1);

        switch (cmd) {
            case '0':
            case '2':
                if (this.onTitle) this.onTitle(arg);
                break;
            case '52':
                // OSC 52: Clipboard operations - require user confirmation for writes
                if (arg.startsWith('c;')) {
                    try {
                        const text = atob(arg.slice(2));
                        // Security: prompt user before allowing clipboard write
                        if (this.onClipboardWrite) {
                            if (this.onClipboardWrite(text)) {
                                navigator.clipboard.writeText(text).catch(() => { });
                            }
                        } else {
                            // Default: allow with console warning
                            console.warn('[ShellPort] OSC 52 clipboard write requested - consider setting onClipboardWrite callback');
                            navigator.clipboard.writeText(text).catch(() => { });
                        }
                    } catch { }
                }
                break;
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
            this.primaryGrid = this.grid;
            this.grid = this.allocGrid(this.cols, this.rows);
            this.useAlternate = true;
            this.scrollbackBuffer = [];
            this.scrollbackOffset = 0;
        }
    }

    switchToPrimaryBuffer() {
        if (this.useAlternate) {
            this.grid = this.primaryGrid;
            this.useAlternate = false;
            this.scrollbackBuffer = [];
            this.scrollbackOffset = 0;
        }
    }

    getScrollTop() { return this.scrollTop || 0; }
    getScrollBottom() { return this.scrollBottom || (this.rows - 1); }

    // -------------------------------------------------------------------------
    // Terminal Operations
    // -------------------------------------------------------------------------

    putChar(c) {
        // VT100 DECAWM: if a previous putChar set wrapPending,
        // execute the deferred line wrap before writing this character
        if (this.wrapPending) {
            this.cursorX = 0;
            this.lineFeed();
            this.wrapPending = false;
        }

        if (this.cursorY >= 0 && this.cursorY < this.rows &&
            this.cursorX >= 0 && this.cursorX < this.cols) {
            const off = (this.cursorY * this.cols + this.cursorX) * CELL_WORDS;
            this.grid[off] = (c.codePointAt(0) << CELL_CP_SHIFT) | (this.curFlags & CELL_FLAGS_MASK);
            this.grid[off + 1] = this.curFg;
            this.grid[off + 2] = this.curBg;
            this.grid[off + 3] = 0;
        }

        if (this.cursorX >= this.cols - 1) {
            // Cursor stays at last column; wrap is deferred until next putChar
            this.wrapPending = true;
        } else {
            this.cursorX++;
        }
    }

    lineFeed() {
        const scrollBottom = this.getScrollBottom();
        if (this.cursorY >= scrollBottom) {
            this.scrollUp(1);
        } else {
            this.cursorY++;
        }
    }

    reverseIndex() {
        const scrollTop = this.getScrollTop();
        if (this.cursorY <= scrollTop) {
            this.scrollDown(1);
        } else {
            this.cursorY--;
        }
    }

    scrollUp(n = 1) {
        const scrollTop = this.getScrollTop();
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            // Save top row to scrollback (if in primary buffer)
            if (!this.useAlternate) {
                this.scrollbackBuffer.push(this.extractRow(scrollTop));
                if (this.scrollbackBuffer.length > this.options.scrollback) {
                    this.scrollbackBuffer.shift();
                }
            }
            // Shift region up by one row (native memcpy via copyWithin)
            const srcStart = (scrollTop + 1) * rowWords;
            const dstStart = scrollTop * rowWords;
            const len = (scrollBottom - scrollTop) * rowWords;
            this.grid.copyWithin(dstStart, srcStart, srcStart + len);
            // Fill bottom row (BCE)
            this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0);
        }
    }

    scrollDown(n = 1) {
        const scrollTop = this.getScrollTop();
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            // Shift region down by one row
            const srcStart = scrollTop * rowWords;
            const len = (scrollBottom - scrollTop) * rowWords;
            this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len);
            // Fill top row (BCE)
            this.fillRow(scrollTop, SPACE_CP, this.curFg, this.curBg, 0);
        }
    }

    eraseDisplay(mode) {
        switch (mode) {
            case 0:
                this.eraseLine(0);
                for (let y = this.cursorY + 1; y < this.rows; y++) {
                    this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0);
                }
                break;
            case 1:
                this.eraseLine(1);
                for (let y = 0; y < this.cursorY; y++) {
                    this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0);
                }
                break;
            case 2:
            case 3:
                for (let y = 0; y < this.rows; y++) {
                    this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0);
                }
                if (mode === 3 && !this.useAlternate) {
                    this.scrollbackBuffer = [];
                    this.scrollbackOffset = 0;
                }
                break;
        }
    }

    eraseLine(mode) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        switch (mode) {
            case 0:
                this.fillRange(this.cursorY, this.cursorX, this.cols, SPACE_CP, this.curFg, this.curBg, 0);
                break;
            case 1:
                this.fillRange(this.cursorY, 0, this.cursorX + 1, SPACE_CP, this.curFg, this.curBg, 0);
                break;
            case 2:
                this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0);
                break;
        }
    }

    eraseChars(n) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        this.fillRange(this.cursorY, this.cursorX, this.cursorX + n, SPACE_CP, this.curFg, this.curBg, 0);
    }

    insertChars(n) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        const rowOffset = this.cursorY * this.cols * CELL_WORDS;
        const srcStart = rowOffset + this.cursorX * CELL_WORDS;
        const dstStart = srcStart + n * CELL_WORDS;
        const rowEnd = rowOffset + this.cols * CELL_WORDS;
        // Shift right (copyWithin handles overlapping correctly)
        this.grid.copyWithin(dstStart, srcStart, rowEnd - n * CELL_WORDS);
        // Fill inserted positions with BCE
        this.fillRange(this.cursorY, this.cursorX, Math.min(this.cursorX + n, this.cols), SPACE_CP, this.curFg, this.curBg, 0);
    }

    deleteChars(n) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        const rowOffset = this.cursorY * this.cols * CELL_WORDS;
        const srcStart = rowOffset + (this.cursorX + n) * CELL_WORDS;
        const dstStart = rowOffset + this.cursorX * CELL_WORDS;
        const rowEnd = rowOffset + this.cols * CELL_WORDS;
        // Shift left
        this.grid.copyWithin(dstStart, srcStart, rowEnd);
        // Fill tail with BCE
        this.fillRange(this.cursorY, this.cols - n, this.cols, SPACE_CP, this.curFg, this.curBg, 0);
    }

    insertLines(n) {
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            if (this.cursorY <= scrollBottom) {
                // Shift rows down from cursorY to scrollBottom-1
                const srcStart = this.cursorY * rowWords;
                const len = (scrollBottom - this.cursorY) * rowWords;
                this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len);
                // Insert empty row at cursorY (BCE)
                this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0);
            }
        }
    }

    deleteLines(n) {
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            if (this.cursorY <= scrollBottom) {
                // Shift rows up from cursorY+1 to scrollBottom
                const srcStart = (this.cursorY + 1) * rowWords;
                const dstStart = this.cursorY * rowWords;
                const len = (scrollBottom - this.cursorY) * rowWords;
                this.grid.copyWithin(dstStart, srcStart, srcStart + len);
                // Fill bottom row (BCE)
                this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0);
            }
        }
    }

    clearScreen() {
        for (let y = 0; y < this.rows; y++) {
            this.fillRow(y, SPACE_CP, COLOR_DEFAULT, COLOR_DEFAULT, 0);
        }
        this.cursorX = 0;
        this.cursorY = 0;
    }

    tabForward(n = 1) {
        for (let i = 0; i < n; i++) {
            let nextTab = this.cursorX + 1;
            while (nextTab < this.cols && !this.tabStops.has(nextTab)) nextTab++;
            this.cursorX = Math.min(nextTab, this.cols - 1);
        }
    }

    tabBackward(n = 1) {
        for (let i = 0; i < n; i++) {
            let prevTab = this.cursorX - 1;
            while (prevTab > 0 && !this.tabStops.has(prevTab)) prevTab--;
            this.cursorX = Math.max(0, prevTab);
        }
    }

    deviceStatusReport(cmd) {
        switch (cmd) {
            case 5: this.send('\x1b[0n'); break;
            case 6: this.send(`\x1b[${this.cursorY + 1};${this.cursorX + 1}R`); break;
        }
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    triggerRender() {
        if (!this.renderPending) {
            this.renderPending = true;
            requestAnimationFrame(() => this.render());
        }
    }

    render() {
        this.renderPending = false;
        this.renderer.render(this);
    }

    startCursorBlink() {
        if (!this.options.cursorBlink) return;
        this.cursorBlinkTimer = setInterval(() => {
            this.cursorBlinkState = !this.cursorBlinkState;
            this.triggerRender();
        }, 530);
    }

    stopCursorBlink() {
        if (this.cursorBlinkTimer) {
            clearInterval(this.cursorBlinkTimer);
            this.cursorBlinkTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Event Handling
    // -------------------------------------------------------------------------

    setupEvents() {
        this.canvas.addEventListener('keydown', e => this.onKeyDown(e));
        this.canvas.addEventListener('keypress', e => this.onKeyPress(e));

        this.canvas.addEventListener('focus', () => {
            this.focused = true;
            this.cursorBlinkState = true;
            this.triggerRender();
            if (this.onFocus) this.onFocus();
        });

        this.canvas.addEventListener('blur', () => {
            this.focused = false;
            this.triggerRender();
            if (this.onBlur) this.onBlur();
        });

        this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', e => this.onMouseUp(e));
        this.canvas.addEventListener('wheel', e => this.onWheel(e));
        this.canvas.addEventListener('contextmenu', e => this.onContextMenu(e));

        const resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(this.container);

        this.canvas.addEventListener('paste', e => this.onPaste(e));
    }

    onKeyDown(e) {
        this.cursorBlinkState = true;
        let seq = '';
        const modifier = (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);

        // F1-F12: xterm escape sequences (codes 16 and 22 are skipped per spec)
        const FKEY_CODES = [null, 'OP', 'OQ', 'OR', 'OS', '[15~', '[17~', '[18~', '[19~', '[20~', '[21~', '[23~', '[24~'];
        if (e.key.startsWith('F') && e.key.length <= 3) {
            const fnum = parseInt(e.key.slice(1));
            if (fnum >= 1 && fnum <= 12 && FKEY_CODES[fnum]) {
                if (fnum <= 4 && !modifier) {
                    seq = '\x1b' + FKEY_CODES[fnum];
                } else if (fnum <= 4) {
                    // F1-F4 with modifiers use CSI form
                    seq = `\x1b[1;${modifier + 1}${FKEY_CODES[fnum][1]}`;
                } else {
                    const code = FKEY_CODES[fnum].slice(1, -1); // extract number from "[N~"
                    seq = modifier ? `\x1b[${code};${modifier + 1}~` : '\x1b' + FKEY_CODES[fnum];
                }
            }
        } else {
            switch (e.key) {
                case 'Enter': seq = '\r'; break;
                case 'Backspace': seq = e.ctrlKey ? '\x08' : '\x7f'; break;
                case 'Tab': seq = e.shiftKey ? '\x1b[Z' : '\t'; break;
                case 'Escape': seq = '\x1b'; break;
                case 'ArrowUp': seq = modifier ? `\x1b[1;${modifier + 1}A` : '\x1b[A'; break;
                case 'ArrowDown': seq = modifier ? `\x1b[1;${modifier + 1}B` : '\x1b[B'; break;
                case 'ArrowRight': seq = modifier ? `\x1b[1;${modifier + 1}C` : '\x1b[C'; break;
                case 'ArrowLeft': seq = modifier ? `\x1b[1;${modifier + 1}D` : '\x1b[D'; break;
                case 'Home': seq = modifier ? `\x1b[1;${modifier + 1}H` : '\x1b[H'; break;
                case 'End': seq = modifier ? `\x1b[1;${modifier + 1}F` : '\x1b[F'; break;
                case 'Insert': seq = '\x1b[2~'; break;
                case 'Delete': seq = '\x1b[3~'; break;
                case 'PageUp': seq = '\x1b[5~'; break;
                case 'PageDown': seq = '\x1b[6~'; break;
                default:
                    // Industry-standard clipboard: Ctrl+Shift+C always copies,
                    // Ctrl+C copies when text is selected (otherwise sends ^C)
                    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
                        if (e.shiftKey || this.selection) {
                            e.preventDefault();
                            this.copyToClipboard();
                            if (!e.shiftKey) this.selection = null; // clear selection after copy
                            this.triggerRender();
                            return;
                        }
                        // No selection + no shift → send ^C
                        seq = '\x03';
                    } else if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
                        // Ctrl+Shift+V: paste from clipboard
                        e.preventDefault();
                        navigator.clipboard.readText().then(text => {
                            if (text) {
                                if (this.bracketedPaste) {
                                    text = '\x1b[200~' + text + '\x1b[201~';
                                }
                                this.send(text);
                            }
                        }).catch(() => {});
                        return;
                    } else if (e.ctrlKey && e.key.length === 1) {
                        const code = e.key.toUpperCase().charCodeAt(0);
                        if (code >= 64 && code <= 95) seq = String.fromCharCode(code - 64);
                    }
                    break;
            }
        }

        if (seq) {
            e.preventDefault();
            this.send(seq);
        } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Let keypress handle it
        } else {
            e.preventDefault();
        }
    }

    onKeyPress(e) {
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.send(e.key);
        }
    }

    onMouseDown(e) {
        if (e.button === 0) {
            if (this.mouseTracking && !e.shiftKey) {
                this.sendMouseReport(e, 'down');
            } else {
                this.isSelecting = true;
                this.selectionStart = this.screenToCell(e.clientX, e.clientY);
                this.selection = {
                    startRow: this.selectionStart.y, endRow: this.selectionStart.y,
                    startCol: this.selectionStart.x, endCol: this.selectionStart.x
                };
            }
        }
        this.canvas.focus();
    }

    onMouseMove(e) {
        if (this.mouseTracking && this.mouseTracking === 1002 && !e.shiftKey) {
            if (this.isSelecting || e.buttons === 1) this.sendMouseReport(e, 'drag');
        } else if (this.isSelecting) {
            const cell = this.screenToCell(e.clientX, e.clientY);
            if (this.selectionStart) {
                if (cell.y < this.selectionStart.y || (cell.y === this.selectionStart.y && cell.x < this.selectionStart.x)) {
                    this.selection = { startRow: cell.y, endRow: this.selectionStart.y, startCol: cell.x, endCol: this.selectionStart.x };
                } else {
                    this.selection = { startRow: this.selectionStart.y, endRow: cell.y, startCol: this.selectionStart.x, endCol: cell.x };
                }
                this.triggerRender();
            }
        }
    }

    onMouseUp(e) {
        if (e.button === 0) {
            if (this.mouseTracking && !e.shiftKey) this.sendMouseReport(e, 'up');
            this.isSelecting = false;
        }
    }

    sendMouseReport(e, type) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.charWidth) + 1;
        const y = Math.floor((e.clientY - rect.top) / this.charHeight) + 1;

        let button = e.button;
        if (type === 'up') button = 3;
        else if (type === 'drag' && e.buttons === 1) button = 32 + 1;
        else if (type === 'drag') return;

        let mods = (e.shiftKey ? 4 : 0) + (e.altKey ? 8 : 0) + (e.ctrlKey ? 16 : 0);

        if (this.mouseProtocol === 'sgr') {
            const final = type === 'up' ? 'm' : 'M';
            this.send(`\x1b[<${button + mods};${x};${y}${final}`);
        } else {
            button += 32; mods += 32;
            this.send(`\x1b[M${String.fromCharCode(button)}${String.fromCharCode(x + 32)}${String.fromCharCode(y + 32)}`);
        }
    }

    onWheel(e) {
        if (this.useAlternate) {
            if (this.mouseTracking) {
                const button = e.deltaY > 0 ? 1 : 0;
                e.button = button + 64;
                this.sendMouseReport(e, 'scroll');
            }
        } else {
            e.preventDefault();
            const delta = Math.round(e.deltaY / this.charHeight);
            this.scrollbackOffset = Math.max(0, Math.min(this.scrollbackBuffer.length, this.scrollbackOffset + delta));
            this.triggerRender();
        }
    }

    onContextMenu(e) {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        if (!menu) return; // No context menu element available
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.classList.add('visible');
        const closeMenu = () => {
            menu.classList.remove('visible');
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    onPaste(e) {
        e.preventDefault();
        let text = e.clipboardData.getData('text/plain');
        if (this.bracketedPaste) {
            text = '\x1b[200~' + text + '\x1b[201~';
        }
        this.send(text);
    }

    screenToCell(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const pad = this.options.padding;
        return {
            x: Math.max(0, Math.min(this.cols - 1, Math.floor((clientX - rect.left - pad) / this.charWidth))),
            y: Math.max(0, Math.min(this.rows - 1, Math.floor((clientY - rect.top - pad) / this.charHeight)))
        };
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    getSelection() {
        if (!this.selection) return '';
        const { startRow, endRow, startCol, endCol } = this.selection;
        const lines = [];
        for (let y = startRow; y <= endRow; y++) {
            if (y < 0 || y >= this.rows) continue;
            const sx = y === startRow ? startCol : 0;
            const ex = y === endRow ? endCol : this.cols;
            let line = '';
            for (let x = sx; x < ex; x++) {
                const off = (y * this.cols + x) * CELL_WORDS;
                const cp = this.grid[off] >>> CELL_CP_SHIFT;
                line += (cp > 0 && cp !== SPACE_CP) ? String.fromCodePoint(cp) : ' ';
            }
            lines.push(line.trimEnd());
        }
        return lines.join('\n');
    }

    copyToClipboard() {
        const text = this.getSelection();
        if (text) navigator.clipboard.writeText(text).catch(() => { });
    }

    clear() {
        this.eraseDisplay(3);
        this.triggerRender();
    }

    destroy() {
        this.stopCursorBlink();
        if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
}

// Expose globally for IIFE bundle and inline <script> usage
globalThis.NanoTermV2 = NanoTermV2;
```

### File: `canvas-renderer.js`

- Size: 21919 bytes
- Modified: 2026-03-20 21:33:20 UTC

```text
<Binary file or unsupported encoding: 21919 bytes>
```

### File: `constants.js`

- Size: 7432 bytes
- Modified: 2026-03-20 21:33:20 UTC

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2 Constants — Shared by all renderers
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2: Feature-Complete VT100/VT220/xterm Emulator
// Hardware-accelerated Canvas2D renderer with zero dependencies
// ═══════════════════════════════════════════════════════════════════════════

// Maximum buffer size for OSC/DCS sequences (64 KB)
export const MAX_SEQUENCE_SIZE = 65536;

// Standard xterm 256-color palette
export const XTERM_256_PALETTE = [
    // 0-15: Standard colors (matched to our theme)
    '#0d0d0d', '#e74c3c', '#2ecc71', '#f1c40f', '#3498db', '#a78bfa', '#1abc9c', '#e0e0e0',
    '#555555', '#ff6b6b', '#4ade80', '#fde047', '#60a5fa', '#c4b5fd', '#2dd4bf', '#ffffff',
    // 16-231: 216 color cube (6x6x6)
    ...Array.from({ length: 216 }, (_, i) => {
        const r = Math.floor(i / 36) * 51;
        const g = (Math.floor(i / 6) % 6) * 51;
        const b = (i % 6) * 51;
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }),
    // 232-255: Grayscale (24 shades)
    ...Array.from({ length: 24 }, (_, i) => {
        const gray = 8 + i * 10;
        return '#' + [gray, gray, gray].map(x => x.toString(16).padStart(2, '0')).join('');
    })
];

// ── Packed Cell Layout ──────────────────────────────────────────────────────
// 16 bytes (4 × Uint32) per cell — matches Ghostty/Alacritty truecolor format
// Word 0: [codepoint: 21 bits][flags: 11 bits]
// Word 1: fg color (32-bit RGBA, 0xRRGGBBFF)   — 0 = default theme fg
// Word 2: bg color (32-bit RGBA, 0xRRGGBBFF)   — 0 = default theme bg
// Word 3: reserved (atlas UV for WebGL phase)
export const CELL_WORDS = 4;
export const CELL_CP_SHIFT = 11;
export const CELL_FLAGS_MASK = 0x7FF;
export const COLOR_DEFAULT = 0;
export const SPACE_CP = 0x20;

// Precompute palette as RGBA uint32 for O(1) lookup
export function hexToRGBA(hex) {
    return ((parseInt(hex.slice(1, 3), 16) << 24) |
            (parseInt(hex.slice(3, 5), 16) << 16) |
            (parseInt(hex.slice(5, 7), 16) << 8) | 0xFF) >>> 0;
}

export function rgbPack(r, g, b) {
    return ((r << 24) | (g << 16) | (b << 8) | 0xFF) >>> 0;
}

export const XTERM_256_RGBA = XTERM_256_PALETTE.map(hexToRGBA);

// CSS color string cache (terminals use <50 distinct colors)
export const _cssCache = new Map();
export function rgbaToCSS(rgba) {
    let css = _cssCache.get(rgba);
    if (css !== undefined) return css;
    const r = (rgba >>> 24) & 0xFF;
    const g = (rgba >>> 16) & 0xFF;
    const b = (rgba >>> 8) & 0xFF;
    css = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    _cssCache.set(rgba, css);
    return css;
}

export const ATTR = {
    BOLD: 1 << 0,
    DIM: 1 << 1,
    ITALIC: 1 << 2,
    UNDERLINE: 1 << 3,
    BLINK: 1 << 4,
    INVERSE: 1 << 5,
    HIDDEN: 1 << 6,
    STRIKETHROUGH: 1 << 7,
    DOUBLE_UNDERLINE: 1 << 8,
    OVERLINE: 1 << 9
};

// DEC Special Graphics character set (used by tmux for box-drawing)
export const DEC_SPECIAL_GRAPHICS = {
    '`': '◆', 'a': '▒', 'f': '°', 'g': '±', 'j': '┘', 'k': '┐',
    'l': '┌', 'm': '└', 'n': '┼', 'o': '⎺', 'p': '⎻', 'q': '─',
    'r': '⎼', 's': '⎽', 't': '├', 'u': '┤', 'v': '┴', 'w': '┬',
    'x': '│', 'y': '≤', 'z': '≥', '{': 'π', '|': '≠', '}': '£',
    '~': '·'
};

// Box Drawing segment table: index = codePoint - 0x2500
// Each entry: [left, right, up, down] where 0=none, 1=light, 2=heavy, 3=double
// null entries fall back to font glyph rendering
export const BOX_DRAWING_SEGMENTS = [
    [1, 1, 0, 0], [2, 2, 0, 0], [0, 0, 1, 1], [0, 0, 2, 2], // 2500-2503 ─━│┃
    [1, 1, 0, 0], [2, 2, 0, 0], [0, 0, 1, 1], [0, 0, 2, 2], // 2504-2507 ┄┅┆┇
    [1, 1, 0, 0], [2, 2, 0, 0], [0, 0, 1, 1], [0, 0, 2, 2], // 2508-250B ┈┉┊┋
    [0, 1, 0, 1], [0, 2, 0, 1], [0, 1, 0, 2], [0, 2, 0, 2], // 250C-250F ┌┍┎┏
    [1, 0, 0, 1], [2, 0, 0, 1], [1, 0, 0, 2], [2, 0, 0, 2], // 2510-2513 ┐┑┒┓
    [0, 1, 1, 0], [0, 2, 1, 0], [0, 1, 2, 0], [0, 2, 2, 0], // 2514-2517 └┕┖┗
    [1, 0, 1, 0], [2, 0, 1, 0], [1, 0, 2, 0], [2, 0, 2, 0], // 2518-251B ┘┙┚┛
    [0, 1, 1, 1], [0, 2, 1, 1], [0, 1, 2, 1], [0, 1, 1, 2], // 251C-251F ├┝┞┟
    [0, 1, 2, 2], [0, 2, 2, 1], [0, 2, 1, 2], [0, 2, 2, 2], // 2520-2523 ┠┡┢┣
    [1, 0, 1, 1], [2, 0, 1, 1], [1, 0, 2, 1], [1, 0, 1, 2], // 2524-2527 ┤┥┦┧
    [1, 0, 2, 2], [2, 0, 2, 1], [2, 0, 1, 2], [2, 0, 2, 2], // 2528-252B ┨┩┪┫
    [1, 1, 0, 1], [2, 1, 0, 1], [1, 2, 0, 1], [2, 2, 0, 1], // 252C-252F ┬┭┮┯
    [1, 1, 0, 2], [2, 1, 0, 2], [1, 2, 0, 2], [2, 2, 0, 2], // 2530-2533 ┰┱┲┳
    [1, 1, 1, 0], [2, 1, 1, 0], [1, 2, 1, 0], [2, 2, 1, 0], // 2534-2537 ┴┵┶┷
    [1, 1, 2, 0], [2, 1, 2, 0], [1, 2, 2, 0], [2, 2, 2, 0], // 2538-253B ┸┹┺┻
    [1, 1, 1, 1], [2, 1, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1], // 253C-253F ┼┽┾┿
    [1, 1, 2, 1], [1, 1, 1, 2], [1, 1, 2, 2], [2, 1, 2, 1], // 2540-2543 ╀╁╂╃
    [1, 2, 2, 1], [2, 1, 1, 2], [1, 2, 1, 2], [2, 2, 2, 1], // 2544-2547 ╄╅╆╇
    [2, 2, 1, 2], [2, 1, 2, 2], [1, 2, 2, 2], [2, 2, 2, 2], // 2548-254B ╈╉╊╋
    [1, 1, 0, 0], [2, 2, 0, 0], [0, 0, 1, 1], [0, 0, 2, 2], // 254C-254F ╌╍╎╏
    [3, 3, 0, 0], [0, 0, 3, 3],                       // 2550-2551 ═║
    [0, 3, 0, 1], [0, 1, 0, 3], [0, 3, 0, 3],             // 2552-2554 ╒╓╔
    [3, 0, 0, 1], [1, 0, 0, 3], [3, 0, 0, 3],             // 2555-2557 ╕╖╗
    [0, 3, 1, 0], [0, 1, 3, 0], [0, 3, 3, 0],             // 2558-255A ╘╙╚
    [3, 0, 1, 0], [1, 0, 3, 0], [3, 0, 3, 0],             // 255B-255D ╛╜╝
    [0, 3, 1, 1], [0, 1, 3, 3], [0, 3, 3, 3],             // 255E-2560 ╞╟╠
    [3, 0, 1, 1], [1, 0, 3, 3], [3, 0, 3, 3],             // 2561-2563 ╡╢╣
    [3, 3, 0, 1], [1, 1, 0, 3], [3, 3, 0, 3],             // 2564-2566 ╤╥╦
    [3, 3, 1, 0], [1, 1, 3, 0], [3, 3, 3, 0],             // 2567-2569 ╧╨╩
    [3, 3, 1, 1], [1, 1, 3, 3], [3, 3, 3, 3],             // 256A-256C ╪╫╬
    null, null, null, null,                                       // 256D-2570 ╭╮╯╰ (font-rendered curves)
    null, null, null,                            // 2571-2573 ╱╲╳ (diagonals)
    [1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1],   // 2574-2577 ╴╵╶╷
    [2, 0, 0, 0], [0, 0, 2, 0], [0, 2, 0, 0], [0, 0, 0, 2],   // 2578-257B ╸╹╺╻
    [1, 2, 0, 0], [0, 0, 1, 2], [2, 1, 0, 0], [0, 0, 2, 1],   // 257C-257F ╼╽╾╿
];
```

### File: `webgl-renderer.js`

- Size: 40815 bytes
- Modified: 2026-03-20 21:33:20 UTC

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// WebGLRenderer — GPU-accelerated rendering backend using WebGL2
//
// Architecture: Full-Screen Quad + Data Texture + Dynamic Glyph Atlas
// - Single draw call per frame (two triangles covering canvas)
// - Grid data uploaded as RGBA32UI texture (zero-copy from Uint32Array)
// - Text glyphs rasterized to offscreen canvas, uploaded to atlas texture
// - Block/box-drawing/braille characters rendered procedurally in shader
// ═══════════════════════════════════════════════════════════════════════════

import {
    CELL_WORDS,
    CELL_CP_SHIFT,
    CELL_FLAGS_MASK,
    COLOR_DEFAULT,
    SPACE_CP,
    ATTR,
    BOX_DRAWING_SEGMENTS,
    hexToRGBA,
    rgbaToCSS
} from './constants.js';

// ── Shader Sources ──────────────────────────────────────────────────────────

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
    // Full-screen quad from vertex ID (no buffers needed)
    // Vertices: (-1,-1), (3,-1), (-1,3) — oversized triangle covers viewport
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    v_uv = vec2((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5); // flip Y for top-left origin
    gl_Position = vec4(x, y, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp usampler2D;

in vec2 v_uv;
out vec4 fragColor;

// Grid data texture (RGBA32UI) — each texel = one cell
uniform usampler2D u_gridTex;
// Glyph atlas texture (RGBA)
uniform sampler2D u_atlasTex;

// Terminal dimensions
uniform ivec2 u_gridSize;       // cols, rows
uniform vec2 u_charSize;        // charWidth, charHeight in pixels
uniform vec2 u_canvasSize;      // canvas width, height in CSS pixels
uniform float u_padding;        // terminal padding
uniform float u_atlasGridSize;  // atlas slots per row (e.g., 64)
uniform vec2 u_atlasTexSize;    // atlas texture size in pixels
uniform vec2 u_atlasCellSize;   // atlas cell size in pixels (charWidth, charHeight)

// Default theme colors (RGBA packed as uint, decoded here)
uniform vec4 u_defaultFg;
uniform vec4 u_defaultBg;

// Cursor
uniform ivec2 u_cursorPos;      // col, row
uniform int u_cursorVisible;    // 0 = hidden, 1 = block, 2 = underline, 3 = bar
uniform vec4 u_cursorColor;

// Selection
uniform ivec4 u_selection;      // startCol, startRow, endCol, endRow (-1 = no selection)

// SGR flag bits (must match ATTR constants)
const uint FLAG_BOLD         = 1u;
const uint FLAG_ITALIC       = 4u;
const uint FLAG_UNDERLINE    = 8u;
const uint FLAG_INVERSE      = 32u;
const uint FLAG_STRIKETHROUGH = 128u;
const uint FLAG_DBL_UNDERLINE = 256u;

// Box drawing segments: stored as a small data texture or decoded from grid word3
uniform usampler2D u_boxTex;    // 128x1 RGBA32UI texture with [left, right, up, down] weights

// ── Helpers ─────────────────────────────────────────────────────────────────

vec4 unpackRGBA(uint packed) {
    return vec4(
        float((packed >> 24u) & 0xFFu) / 255.0,
        float((packed >> 16u) & 0xFFu) / 255.0,
        float((packed >>  8u) & 0xFFu) / 255.0,
        float( packed         & 0xFFu) / 255.0
    );
}

vec4 resolveColor(uint color, vec4 defaultColor) {
    return color == 0u ? defaultColor : unpackRGBA(color);
}

// ── Main Fragment ───────────────────────────────────────────────────────────

void main() {
    // Convert UV to pixel coordinates (CSS pixels)
    vec2 pixelPos = v_uv * u_canvasSize;

    // Account for padding
    vec2 termPos = pixelPos - vec2(u_padding);

    // Which cell are we in?
    ivec2 cell = ivec2(floor(termPos / u_charSize));

    // Out-of-bounds → background
    if (cell.x < 0 || cell.y < 0 || cell.x >= u_gridSize.x || cell.y >= u_gridSize.y ||
        termPos.x < 0.0 || termPos.y < 0.0) {
        fragColor = u_defaultBg;
        return;
    }

    // Local UV within this cell [0, 1]
    vec2 localUV = fract(termPos / u_charSize);

    // Fetch cell data from grid texture
    uvec4 cellData = texelFetch(u_gridTex, cell, 0);
    uint word0 = cellData.r;  // codepoint + flags
    uint fgPacked = cellData.g;  // FG RGBA
    uint bgPacked = cellData.b;  // BG RGBA
    uint atlasIdx = cellData.a;  // atlas UV index

    uint codepoint = word0 >> 11u;
    uint flags = word0 & 0x7FFu;

    // ── Resolve colors (with inversion) ──
    vec4 bgColor, fgColor;
    if ((flags & FLAG_INVERSE) != 0u) {
        bgColor = resolveColor(fgPacked, u_defaultFg);
        fgColor = resolveColor(bgPacked, u_defaultBg);
    } else {
        bgColor = resolveColor(bgPacked, u_defaultBg);
        fgColor = resolveColor(fgPacked, u_defaultFg);
    }

    // Start with background
    vec4 color = bgColor;

    // ── Procedural block characters (U+2580–U+259F) ──
    if (codepoint >= 0x2580u && codepoint <= 0x259Fu) {
        vec4 blockColor = fgColor;

        if (codepoint == 0x2588u) {
            // Full block
            color = blockColor;
        } else if (codepoint == 0x2580u) {
            // Upper half
            if (localUV.y < 0.5) color = blockColor;
        } else if (codepoint >= 0x2581u && codepoint <= 0x2587u) {
            // Lower N/8 blocks
            float frac = float(codepoint - 0x2580u) / 8.0;
            if (localUV.y >= 1.0 - frac) color = blockColor;
        } else if (codepoint >= 0x2589u && codepoint <= 0x258Fu) {
            // Left N/8 blocks
            float frac = float(0x2590u - codepoint) / 8.0;
            if (localUV.x < frac) color = blockColor;
        } else if (codepoint == 0x2590u) {
            // Right half
            if (localUV.x >= 0.5) color = blockColor;
        } else if (codepoint >= 0x2591u && codepoint <= 0x2593u) {
            // Shade characters (stipple pattern using checkerboard)
            float density = float(codepoint - 0x2590u) * 0.25;
            // Use a hash-like pattern for stipple
            vec2 pixInCell = localUV * u_charSize;
            float pattern = fract(sin(dot(floor(pixInCell), vec2(12.9898, 78.233))) * 43758.5453);
            if (pattern < density) color = blockColor;
        } else if (codepoint == 0x2594u) {
            // Upper 1/8 block
            if (localUV.y < 0.125) color = blockColor;
        } else if (codepoint == 0x2595u) {
            // Right 1/8 block
            if (localUV.x >= 0.875) color = blockColor;
        } else if (codepoint >= 0x2596u && codepoint <= 0x259Fu) {
            // Quadrant characters
            // Bit layout: TL=8, TR=4, BL=2, BR=1
            uint qIdx = codepoint - 0x2596u;
            // Quadrant masks for 0x2596-0x259F
            uint masks[10] = uint[10](
                0x2u, 0x1u, 0x8u, 0xBu, 0x9u,
                0xEu, 0xDu, 0x4u, 0x6u, 0x7u
            );
            uint mask = masks[qIdx];
            bool inLeft = localUV.x < 0.5;
            bool inTop  = localUV.y < 0.5;
            bool hit = false;
            if (inTop  && inLeft  && (mask & 8u) != 0u) hit = true;
            if (inTop  && !inLeft && (mask & 4u) != 0u) hit = true;
            if (!inTop && inLeft  && (mask & 2u) != 0u) hit = true;
            if (!inTop && !inLeft && (mask & 1u) != 0u) hit = true;
            if (hit) color = blockColor;
        }
    }
    // ── Procedural box drawing (U+2500–U+257F) ──
    else if (codepoint >= 0x2500u && codepoint <= 0x257Fu) {
        uint idx = codepoint - 0x2500u;
        uvec4 boxData = texelFetch(u_boxTex, ivec2(int(idx), 0), 0);
        uint lw = boxData.r;
        uint rw = boxData.g;
        uint uw = boxData.b;
        uint dw = boxData.a;

        // Null entries (all weights 0) = curved/diagonal chars → fall through to atlas
        if (lw != 0u || rw != 0u || uw != 0u || dw != 0u) {
            float cx = 0.5;
            float cy = 0.5;
            float thinW = 1.0 / u_charSize.x;    // 1px line width in UV
            float thinH = 1.0 / u_charSize.y;
            float thickW = max(2.0, u_charSize.x * 0.2) / u_charSize.x;
            float thickH = max(2.0, u_charSize.y * 0.2) / u_charSize.y;
            float gapW = max(2.0, u_charSize.x * 0.3) / u_charSize.x;
            float gapH = max(2.0, u_charSize.y * 0.3) / u_charSize.y;

            bool hit = false;

            // Horizontal segments — extend past center to ensure overlap
            // Left segment
            if (lw > 0u && localUV.x <= cx + thinW * 0.5) {
                if (lw == 1u && abs(localUV.y - cy) < thinH * 0.5 + 0.001) hit = true;
                if (lw == 2u && abs(localUV.y - cy) < thickH * 0.5) hit = true;
                if (lw == 3u && (abs(localUV.y - cy - gapH) < thinH * 0.5 || abs(localUV.y - cy + gapH) < thinH * 0.5)) hit = true;
            }
            // Right segment
            if (rw > 0u && localUV.x >= cx - thinW * 0.5) {
                if (rw == 1u && abs(localUV.y - cy) < thinH * 0.5 + 0.001) hit = true;
                if (rw == 2u && abs(localUV.y - cy) < thickH * 0.5) hit = true;
                if (rw == 3u && (abs(localUV.y - cy - gapH) < thinH * 0.5 || abs(localUV.y - cy + gapH) < thinH * 0.5)) hit = true;
            }
            // Up segment
            if (uw > 0u && localUV.y <= cy + thinH * 0.5) {
                if (uw == 1u && abs(localUV.x - cx) < thinW * 0.5 + 0.001) hit = true;
                if (uw == 2u && abs(localUV.x - cx) < thickW * 0.5) hit = true;
                if (uw == 3u && (abs(localUV.x - cx - gapW) < thinW * 0.5 || abs(localUV.x - cx + gapW) < thinW * 0.5)) hit = true;
            }
            // Down segment
            if (dw > 0u && localUV.y >= cy - thinH * 0.5) {
                if (dw == 1u && abs(localUV.x - cx) < thinW * 0.5 + 0.001) hit = true;
                if (dw == 2u && abs(localUV.x - cx) < thickW * 0.5) hit = true;
                if (dw == 3u && (abs(localUV.x - cx - gapW) < thinW * 0.5 || abs(localUV.x - cx + gapW) < thinW * 0.5)) hit = true;
            }

            if (hit) color = fgColor;
        }
        // Null entries: procedural rounded corners + diagonals
        else {
            float thinW = 1.0 / u_charSize.x;
            float thinH = 1.0 / u_charSize.y;
            bool hit = false;

            if (codepoint >= 0x256Du && codepoint <= 0x2570u) {
                // Rounded corners — quarter circle arcs in pixel space
                // Work in pixel coordinates for correct aspect ratio
                vec2 px = localUV * u_charSize;  // pixel position within cell
                float halfW = u_charSize.x * 0.5;
                float halfH = u_charSize.y * 0.5;
                vec2 center;
                bool inQuadrant = false;

                if (codepoint == 0x256Du) {
                    // ╭ top-left corner: arc center at bottom-right
                    center = u_charSize;
                    inQuadrant = (px.x <= halfW && px.y <= halfH);
                } else if (codepoint == 0x256Eu) {
                    // ╮ top-right corner: arc center at bottom-left
                    center = vec2(0.0, u_charSize.y);
                    inQuadrant = (px.x >= halfW && px.y <= halfH);
                } else if (codepoint == 0x256Fu) {
                    // ╯ bottom-right corner: arc center at top-left
                    center = vec2(0.0, 0.0);
                    inQuadrant = (px.x >= halfW && px.y >= halfH);
                } else {
                    // ╰ bottom-left corner: arc center at top-right
                    center = vec2(u_charSize.x, 0.0);
                    inQuadrant = (px.x <= halfW && px.y >= halfH);
                }

                if (inQuadrant) {
                    float dist = length(px - center);
                    // Radius reaches to cell edge midpoints
                    float radius = min(halfW, halfH);
                    // Use same thickness as straight segments (1px)
                    if (abs(dist - radius) < 0.8) hit = true;
                }
            }
            else if (codepoint == 0x2571u) {
                // ╱ Forward diagonal
                vec2 px = localUV * u_charSize;
                float d = abs(px.x / u_charSize.x + px.y / u_charSize.y - 1.0);
                if (d < thinH * 0.7) hit = true;
            }
            else if (codepoint == 0x2572u) {
                // ╲ Back diagonal
                vec2 px = localUV * u_charSize;
                float d = abs(px.x / u_charSize.x - px.y / u_charSize.y);
                if (d < thinH * 0.7) hit = true;
            }
            else if (codepoint == 0x2573u) {
                // ╳ Cross diagonal
                vec2 px = localUV * u_charSize;
                float d1 = abs(px.x / u_charSize.x + px.y / u_charSize.y - 1.0);
                float d2 = abs(px.x / u_charSize.x - px.y / u_charSize.y);
                if (d1 < thinH * 0.7 || d2 < thinH * 0.7) hit = true;
            }

            if (hit) color = fgColor;
        }
    }
    // ── Procedural braille (U+2800–U+28FF) ──
    else if (codepoint >= 0x2800u && codepoint <= 0x28FFu) {
        uint bits = codepoint - 0x2800u;
        if (bits != 0u) {
            float dotR = 0.12; // dot radius in UV space
            // Braille grid: 2 cols × 4 rows
            // Left column at x=0.3, right at x=0.7
            // Rows at y = 0.15, 0.35, 0.55, 0.75
            // Bit mapping: b0=TL, b1=ML, b2=BL, b3=TR, b4=MR, b5=BR, b6=LL, b7=LR
            vec2 dotPositions[8] = vec2[8](
                vec2(0.3, 0.15), vec2(0.3, 0.35), vec2(0.3, 0.55),
                vec2(0.3, 0.75), // b0-b2, b6(bit6)
                vec2(0.7, 0.15), vec2(0.7, 0.35), vec2(0.7, 0.55),
                vec2(0.7, 0.75)  // b3-b5, b7(bit7)
            );
            // Remap bit indices: bits [0,1,2,6, 3,4,5,7] → positions [0,1,2,3, 4,5,6,7]
            uint bitMap[8] = uint[8](0u, 1u, 2u, 6u, 3u, 4u, 5u, 7u);
            
            for (int i = 0; i < 8; i++) {
                if ((bits & (1u << bitMap[i])) != 0u) {
                    float d = length(localUV - dotPositions[i]);
                    if (d < dotR) {
                        color = fgColor;
                        break;
                    }
                }
            }
        }
    }
    // ── Atlas text rendering ──
    else if (codepoint > 32u && atlasIdx > 0u) {
        // Decode atlas position from index
        uint atlasX = (atlasIdx - 1u) % uint(u_atlasGridSize);
        uint atlasY = (atlasIdx - 1u) / uint(u_atlasGridSize);

        // Calculate UV in atlas texture
        vec2 atlasUV = vec2(
            (float(atlasX) * u_atlasCellSize.x + localUV.x * u_atlasCellSize.x) / u_atlasTexSize.x,
            (float(atlasY) * u_atlasCellSize.y + localUV.y * u_atlasCellSize.y) / u_atlasTexSize.y
        );

        // Apply italic skew
        if ((flags & FLAG_ITALIC) != 0u) {
            float skew = (1.0 - localUV.y) * 0.2; // skew based on vertical position
            atlasUV.x += skew * u_atlasCellSize.x / u_atlasTexSize.x;
        }

        vec4 glyph = texture(u_atlasTex, atlasUV);
        // Alpha compositing: glyph alpha modulates fg color over bg
        color = mix(color, fgColor, glyph.a);
    }

    // ── Decorations ──
    if ((flags & FLAG_UNDERLINE) != 0u) {
        if (localUV.y > 0.88 && localUV.y < 0.94) color = fgColor;
    }
    if ((flags & FLAG_DBL_UNDERLINE) != 0u) {
        if ((localUV.y > 0.82 && localUV.y < 0.86) ||
            (localUV.y > 0.90 && localUV.y < 0.94)) color = fgColor;
    }
    if ((flags & FLAG_STRIKETHROUGH) != 0u) {
        if (localUV.y > 0.46 && localUV.y < 0.54) color = fgColor;
    }

    // ── Selection overlay ──
    if (u_selection.x >= 0) {
        int selStartCol = u_selection.x;
        int selStartRow = u_selection.y;
        int selEndCol = u_selection.z;
        int selEndRow = u_selection.w;

        bool inSelection = false;
        if (cell.y > selStartRow && cell.y < selEndRow) {
            inSelection = true;
        } else if (cell.y == selStartRow && cell.y == selEndRow) {
            inSelection = cell.x >= selStartCol && cell.x < selEndCol;
        } else if (cell.y == selStartRow) {
            inSelection = cell.x >= selStartCol;
        } else if (cell.y == selEndRow) {
            inSelection = cell.x < selEndCol;
        }

        if (inSelection) {
            color = mix(color, vec4(1.0, 1.0, 1.0, 0.3), 0.3);
        }
    }

    // ── Cursor ──
    if (u_cursorVisible > 0 && cell.x == u_cursorPos.x && cell.y == u_cursorPos.y) {
        if (u_cursorVisible == 1) {
            // Block cursor
            color = u_cursorColor;
            // Re-render glyph in background color for legibility
            if (codepoint > 32u && atlasIdx > 0u) {
                uint ax = (atlasIdx - 1u) % uint(u_atlasGridSize);
                uint ay = (atlasIdx - 1u) / uint(u_atlasGridSize);
                vec2 aUV = vec2(
                    (float(ax) * u_atlasCellSize.x + localUV.x * u_atlasCellSize.x) / u_atlasTexSize.x,
                    (float(ay) * u_atlasCellSize.y + localUV.y * u_atlasCellSize.y) / u_atlasTexSize.y
                );
                vec4 g = texture(u_atlasTex, aUV);
                color = mix(color, u_defaultBg, g.a);
            }
        } else if (u_cursorVisible == 2) {
            // Underline cursor
            if (localUV.y > 0.85) color = u_cursorColor;
        } else if (u_cursorVisible == 3) {
            // Bar cursor
            if (localUV.x < 2.0 / u_charSize.x) color = u_cursorColor;
        }
    }

    fragColor = vec4(color.rgb, 1.0);
}`;

// ── Atlas Constants ─────────────────────────────────────────────────────────

const ATLAS_SIZE = 2048;      // Atlas texture size (2048×2048)

// ═══════════════════════════════════════════════════════════════════════════
// WebGLRenderer Class
// ═══════════════════════════════════════════════════════════════════════════

export class WebGLRenderer {
    constructor(container, options, colors) {
        this.options = options;
        this.colors = colors;
        this.charWidth = 0;
        this.charHeight = 0;
        this._renderCols = 0;

        // Theme colors as RGBA uint32
        this.themeFgRGBA = hexToRGBA(colors.foreground);
        this.themeBgRGBA = hexToRGBA(colors.background);

        // Glyph availability cache (shared with CanvasRenderer approach)
        this._glyphCache = new Map();
        this._puaAvailable = false;
        this._tofuData = null;

        // Atlas state
        this._atlasMap = new Map();  // codepoint|flags → atlasIndex (1-based)
        this._atlasNextSlot = 1;     // next free slot (1-based, 0 = empty)
        this._atlasCanvas = null;
        this._atlasCtx = null;
        this._atlasSlotsPerRow = 0;

        // WebGL state
        this.gl = null;
        this.program = null;
        this.uniforms = {};
        this.gridTexture = null;
        this.atlasTexture = null;
        this.boxTexture = null;
        this._lastGridCols = 0;
        this._lastGridRows = 0;

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'term-canvas';
        this.canvas.tabIndex = 0;
        container.appendChild(this.canvas);

        // Init WebGL2
        this._initGL();
    }

    // ── WebGL2 Initialization ───────────────────────────────────────────────

    _initGL() {
        const gl = this.canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });

        if (!gl) throw new Error('WebGL2 not supported');
        this.gl = gl;

        // Compile shaders
        const vs = this._compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

        // Link program
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('Shader link failed: ' + gl.getProgramInfoLog(prog));
        }
        this.program = prog;
        gl.useProgram(prog);

        // Cache uniform locations
        const names = [
            'u_gridTex', 'u_atlasTex', 'u_boxTex',
            'u_gridSize', 'u_charSize', 'u_canvasSize', 'u_padding',
            'u_atlasGridSize', 'u_atlasTexSize', 'u_atlasCellSize',
            'u_defaultFg', 'u_defaultBg',
            'u_cursorPos', 'u_cursorVisible', 'u_cursorColor',
            'u_selection',
        ];
        for (const n of names) {
            this.uniforms[n] = gl.getUniformLocation(prog, n);
        }

        // Create textures
        this.gridTexture = this._createTexture(gl.TEXTURE0);
        this.atlasTexture = this._createTexture(gl.TEXTURE1);
        this.boxTexture = this._createTexture(gl.TEXTURE2);

        // Bind texture units
        gl.uniform1i(this.uniforms.u_gridTex, 0);
        gl.uniform1i(this.uniforms.u_atlasTex, 1);
        gl.uniform1i(this.uniforms.u_boxTex, 2);

        // Upload box drawing segment data
        this._uploadBoxTexture();

        // Create empty VAO (Full-Screen Quad uses gl_VertexID)
        this._vao = gl.createVertexArray();
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile failed (${type === gl.VERTEX_SHADER ? 'VS' : 'FS'}): ${log}`);
        }
        return shader;
    }

    _createTexture(unit) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.activeTexture(unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    _uploadBoxTexture() {
        const gl = this.gl;
        // Upload BOX_DRAWING_SEGMENTS as 128×1 RGBA32UI texture
        const count = BOX_DRAWING_SEGMENTS.length;
        const data = new Uint32Array(count * 4);
        for (let i = 0; i < count; i++) {
            const seg = BOX_DRAWING_SEGMENTS[i];
            if (!seg) continue; // null entries (rounded corners, diagonals) → zeros
            data[i * 4 + 0] = seg[0]; // left weight
            data[i * 4 + 1] = seg[1]; // right weight
            data[i * 4 + 2] = seg[2]; // up weight
            data[i * 4 + 3] = seg[3]; // down weight
        }
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.boxTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, count, 1, 0,
            gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
    }

    // ── Font Measurement (CPU-side, identical to CanvasRenderer) ─────────────

    measureChar() {
        const testCanvas = document.createElement('canvas');
        const testCtx = testCanvas.getContext('2d');
        const fontSize = this.options.fontSize;
        testCtx.font = `${fontSize}px ${this.options.fontFamily}`;
        const m = testCtx.measureText('W');
        this.charWidth = Math.ceil(m.width);
        const lineHeight = this.options.lineHeight || 1.15;
        this.charHeight = Math.ceil(fontSize * lineHeight);

        // Invalidate atlas on font change
        this._resetAtlas();

        // Probe PUA glyphs
        this._tofuData = null;
        this._glyphCache.clear();
        this._puaAvailable = this._probeGlyph('\uE0B0') ||
                             this._probeGlyph('\uE0A0') ||
                             this._probeGlyph('\uF001');
    }

    // ── Glyph Probing (identical to CanvasRenderer) ─────────────────────────

    _probeGlyph(ch) {
        const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`;
        const size = Math.max(24, this.options.fontSize + 8);

        if (!this._tofuData) {
            const ref = document.createElement('canvas');
            ref.width = size; ref.height = size;
            const rctx = ref.getContext('2d', { willReadFrequently: true });
            rctx.font = fontSpec;
            rctx.textBaseline = 'top';
            rctx.fillStyle = '#fff';
            rctx.fillText('\uFFFF', 2, 2);
            this._tofuData = rctx.getImageData(0, 0, size, size).data;
        }

        const probe = document.createElement('canvas');
        probe.width = size; probe.height = size;
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        pctx.font = fontSpec;
        pctx.textBaseline = 'top';
        pctx.fillStyle = '#fff';
        pctx.fillText(ch, 2, 2);
        const testData = pctx.getImageData(0, 0, size, size).data;

        let diff = 0;
        let hasPixels = false;
        for (let i = 3; i < testData.length; i += 4) {
            if (testData[i] > 0) hasPixels = true;
            if (testData[i] !== this._tofuData[i]) diff++;
        }

        if (diff === 0 && hasPixels) return false;
        if (!hasPixels) return false;
        return true;
    }

    _isGlyphRenderable(cp) {
        if (cp < 0x0530) return true;
        if (cp >= 0x4E00 && cp <= 0x9FFF) return true;
        if (cp >= 0xE000 && cp <= 0xF8FF) return this._puaAvailable;
        if (cp >= 0xF0000) return this._puaAvailable;
        const cached = this._glyphCache.get(cp);
        if (cached !== undefined) return cached;
        const renderable = this._probeGlyph(String.fromCodePoint(cp));
        this._glyphCache.set(cp, renderable);
        return renderable;
    }

    // ── Glyph Atlas ─────────────────────────────────────────────────────────

    _resetAtlas() {
        this._atlasMap.clear();
        this._atlasNextSlot = 1;

        if (this.charWidth > 0 && this.charHeight > 0) {
            this._atlasSlotsPerRow = Math.floor(ATLAS_SIZE / this.charWidth);
        }

        // Create/recreate offscreen atlas canvas
        this._atlasCanvas = document.createElement('canvas');
        this._atlasCanvas.width = ATLAS_SIZE;
        this._atlasCanvas.height = ATLAS_SIZE;
        this._atlasCtx = this._atlasCanvas.getContext('2d', { willReadFrequently: true });

        // Clear atlas canvas
        this._atlasCtx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

        // Upload empty atlas texture
        if (this.gl && this.atlasTexture) {
            const gl = this.gl;
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS_SIZE, ATLAS_SIZE, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
    }

    /**
     * Get or create atlas slot for a codepoint with given flags (bold/italic).
     * Returns the 1-based atlas index, or 0 if the glyph can't be rendered.
     */
    _getAtlasIndex(cp, flags) {
        // Skip special characters (rendered procedurally in shader)
        if (cp >= 0x2500 && cp <= 0x259F) return 0;
        if (cp >= 0x2800 && cp <= 0x28FF) return 0;
        if (cp === SPACE_CP || cp === 0) return 0;

        // Key includes bold/italic flags for distinct atlas entries
        const styleFlags = flags & (ATTR.BOLD | ATTR.ITALIC);
        const key = (cp << 4) | styleFlags;

        const existing = this._atlasMap.get(key);
        if (existing !== undefined) return existing;

        // Check if glyph is renderable
        if (!this._isGlyphRenderable(cp)) {
            this._atlasMap.set(key, 0);
            return 0;
        }

        // Check atlas capacity
        const maxSlots = this._atlasSlotsPerRow * Math.floor(ATLAS_SIZE / this.charHeight);
        if (this._atlasNextSlot >= maxSlots) {
            // Atlas full — rebuild (clear and re-upload visible glyphs)
            this._rebuildAtlas();
        }

        // Assign slot
        const slot = this._atlasNextSlot++;
        this._atlasMap.set(key, slot);

        // Rasterize glyph to offscreen canvas
        const slotX = ((slot - 1) % this._atlasSlotsPerRow) * this.charWidth;
        const slotY = Math.floor((slot - 1) / this._atlasSlotsPerRow) * this.charHeight;

        const ctx = this._atlasCtx;
        ctx.clearRect(slotX, slotY, this.charWidth, this.charHeight);

        const fontParts = [];
        if (styleFlags & ATTR.BOLD) fontParts.push('bold');
        if (styleFlags & ATTR.ITALIC) fontParts.push('italic');
        fontParts.push(`${this.options.fontSize}px`);
        fontParts.push(this.options.fontFamily);
        ctx.font = fontParts.join(' ');
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#fff'; // White glyph — shader tints with FG color via alpha
        ctx.fillText(String.fromCodePoint(cp), slotX, slotY);

        // Upload this single glyph to the GPU atlas texture
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
        // Extract just this glyph's pixels
        const pixels = ctx.getImageData(slotX, slotY, this.charWidth, this.charHeight);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, slotX, slotY,
            this.charWidth, this.charHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);

        return slot;
    }

    _rebuildAtlas() {
        // Clear and start over — simpler than LRU
        this._atlasMap.clear();
        this._atlasNextSlot = 1;
        this._atlasCtx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    }

    // ── Resize ──────────────────────────────────────────────────────────────

    resizeCanvas(containerRect) {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = containerRect.width * dpr;
        this.canvas.height = containerRect.height * dpr;
        this.canvas.style.width = containerRect.width + 'px';
        this.canvas.style.height = containerRect.height + 'px';

        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    // ── Main Render ─────────────────────────────────────────────────────────

    render(term) {
        const gl = this.gl;
        if (!gl || !term.grid) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.canvas.width / dpr;
        const cssHeight = this.canvas.height / dpr;
        const pad = this.options.padding;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.program);

        // ── Build visible grid snapshot ──
        // Assemble visible rows into a contiguous Uint32Array for GPU upload
        const { gridData, visibleCols, visibleRows } = this._buildVisibleGrid(term);

        // ── Upload grid data texture ──
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.gridTexture);

        if (visibleCols !== this._lastGridCols || visibleRows !== this._lastGridRows) {
            // Reallocate texture
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI,
                visibleCols, visibleRows, 0,
                gl.RGBA_INTEGER, gl.UNSIGNED_INT, gridData);
            this._lastGridCols = visibleCols;
            this._lastGridRows = visibleRows;
        } else {
            // Update existing texture
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0,
                visibleCols, visibleRows,
                gl.RGBA_INTEGER, gl.UNSIGNED_INT, gridData);
        }

        // ── Process atlas for all visible glyphs ──
        this._updateAtlasForGrid(gridData, visibleCols, visibleRows);

        // ── Set uniforms ──
        gl.uniform2i(this.uniforms.u_gridSize, visibleCols, visibleRows);
        gl.uniform2f(this.uniforms.u_charSize, this.charWidth, this.charHeight);
        gl.uniform2f(this.uniforms.u_canvasSize, cssWidth, cssHeight);
        gl.uniform1f(this.uniforms.u_padding, pad);

        // Atlas info
        gl.uniform1f(this.uniforms.u_atlasGridSize, this._atlasSlotsPerRow);
        gl.uniform2f(this.uniforms.u_atlasTexSize, ATLAS_SIZE, ATLAS_SIZE);
        gl.uniform2f(this.uniforms.u_atlasCellSize, this.charWidth, this.charHeight);

        // Default colors
        const dfg = this.themeFgRGBA;
        const dbg = this.themeBgRGBA;
        gl.uniform4f(this.uniforms.u_defaultFg,
            ((dfg >>> 24) & 0xFF) / 255, ((dfg >>> 16) & 0xFF) / 255,
            ((dfg >>>  8) & 0xFF) / 255, (dfg & 0xFF) / 255);
        gl.uniform4f(this.uniforms.u_defaultBg,
            ((dbg >>> 24) & 0xFF) / 255, ((dbg >>> 16) & 0xFF) / 255,
            ((dbg >>>  8) & 0xFF) / 255, (dbg & 0xFF) / 255);

        // Cursor
        const cursorStyle = this.options.cursorStyle || 'block';
        let cursorVis = 0;
        if (term.cursorVisible && term.focused) {
            if (!this.options.cursorBlink || term.cursorBlinkState) {
                if (cursorStyle === 'block') cursorVis = 1;
                else if (cursorStyle === 'underline') cursorVis = 2;
                else if (cursorStyle === 'bar') cursorVis = 3;
            }
        }
        gl.uniform2i(this.uniforms.u_cursorPos, term.cursorX, term.cursorY);
        gl.uniform1i(this.uniforms.u_cursorVisible, cursorVis);

        const cc = hexToRGBA(this.colors.cursor);
        gl.uniform4f(this.uniforms.u_cursorColor,
            ((cc >>> 24) & 0xFF) / 255, ((cc >>> 16) & 0xFF) / 255,
            ((cc >>>  8) & 0xFF) / 255, (cc & 0xFF) / 255);

        // Selection
        if (term.selection) {
            gl.uniform4i(this.uniforms.u_selection,
                term.selection.startCol, term.selection.startRow,
                term.selection.endCol, term.selection.endRow);
        } else {
            gl.uniform4i(this.uniforms.u_selection, -1, -1, -1, -1);
        }

        // ── Draw ──
        gl.bindVertexArray(this._vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }

    // ── Build Visible Grid ──────────────────────────────────────────────────

    _buildVisibleGrid(term) {
        const cols = term.cols;
        const rows = term.rows;
        const scrollbackVisible = term.scrollbackOffset > 0 && !term.useAlternate;

        // Output: cols × rows RGBA32UI (4 uints per cell, 1 texel per cell)
        const gridData = new Uint32Array(cols * rows * 4);

        let destRow = 0;

        if (scrollbackVisible) {
            const scrollbackStart = Math.max(0, term.scrollbackBuffer.length - term.scrollbackOffset);
            const scrollbackRows = Math.min(term.scrollbackOffset, rows);

            // Copy scrollback rows
            for (let i = 0; i < scrollbackRows; i++) {
                const idx = scrollbackStart + i;
                if (idx < term.scrollbackBuffer.length) {
                    const sbRow = term.scrollbackBuffer[idx];
                    const sbCols = sbRow.length / CELL_WORDS;
                    const copyCount = Math.min(sbCols, cols);
                    const destOff = destRow * cols * 4;
                    for (let x = 0; x < copyCount; x++) {
                        gridData[destOff + x * 4 + 0] = sbRow[x * CELL_WORDS + 0];
                        gridData[destOff + x * 4 + 1] = sbRow[x * CELL_WORDS + 1];
                        gridData[destOff + x * 4 + 2] = sbRow[x * CELL_WORDS + 2];
                        gridData[destOff + x * 4 + 3] = sbRow[x * CELL_WORDS + 3];
                    }
                }
                destRow++;
            }

            // Copy active grid rows
            const activeStart = 0;
            const activeCount = rows - scrollbackRows;
            for (let y = 0; y < activeCount; y++) {
                const srcOff = (activeStart + y) * cols * CELL_WORDS;
                const destOff = destRow * cols * 4;
                for (let x = 0; x < cols; x++) {
                    gridData[destOff + x * 4 + 0] = term.grid[srcOff + x * CELL_WORDS + 0];
                    gridData[destOff + x * 4 + 1] = term.grid[srcOff + x * CELL_WORDS + 1];
                    gridData[destOff + x * 4 + 2] = term.grid[srcOff + x * CELL_WORDS + 2];
                    gridData[destOff + x * 4 + 3] = term.grid[srcOff + x * CELL_WORDS + 3];
                }
                destRow++;
            }
        } else {
            // Direct copy from active grid
            for (let y = 0; y < rows; y++) {
                const srcOff = y * cols * CELL_WORDS;
                const destOff = y * cols * 4;
                for (let x = 0; x < cols; x++) {
                    gridData[destOff + x * 4 + 0] = term.grid[srcOff + x * CELL_WORDS + 0];
                    gridData[destOff + x * 4 + 1] = term.grid[srcOff + x * CELL_WORDS + 1];
                    gridData[destOff + x * 4 + 2] = term.grid[srcOff + x * CELL_WORDS + 2];
                    gridData[destOff + x * 4 + 3] = term.grid[srcOff + x * CELL_WORDS + 3];
                }
            }
        }

        return { gridData, visibleCols: cols, visibleRows: rows };
    }

    // ── Update Atlas for Visible Grid ───────────────────────────────────────

    _updateAtlasForGrid(gridData, cols, rows) {
        const total = cols * rows;
        for (let i = 0; i < total; i++) {
            const word0 = gridData[i * 4];
            const cp = word0 >>> CELL_CP_SHIFT;
            const flags = word0 & CELL_FLAGS_MASK;

            if (cp <= 32) continue;
            // Skip procedural chars
            if (cp >= 0x2500 && cp <= 0x259F) continue;
            if (cp >= 0x2800 && cp <= 0x28FF) continue;

            const atlasIdx = this._getAtlasIndex(cp, flags);
            // Write atlas index back into gridData word3
            gridData[i * 4 + 3] = atlasIdx;
        }

        // Re-upload grid with atlas indices filled in
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.gridTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0,
            cols, rows,
            gl.RGBA_INTEGER, gl.UNSIGNED_INT, gridData);
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    destroy() {
        const gl = this.gl;
        if (gl) {
            if (this.gridTexture) gl.deleteTexture(this.gridTexture);
            if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
            if (this.boxTexture) gl.deleteTexture(this.boxTexture);
            if (this.program) gl.deleteProgram(this.program);
            if (this._vao) gl.deleteVertexArray(this._vao);
        }
        if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
}
```
