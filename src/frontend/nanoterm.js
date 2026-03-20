// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2: Feature-Complete VT100/VT220/xterm Emulator
// Hardware-accelerated Canvas2D renderer with zero dependencies
// ═══════════════════════════════════════════════════════════════════════════

// Maximum buffer size for OSC/DCS sequences (64 KB)
const MAX_SEQUENCE_SIZE = 65536;

// Standard xterm 256-color palette
const XTERM_256_PALETTE = [
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
const CELL_WORDS = 4;
const CELL_CP_SHIFT = 11;
const CELL_FLAGS_MASK = 0x7FF;
const COLOR_DEFAULT = 0;
const SPACE_CP = 0x20;

// Precompute palette as RGBA uint32 for O(1) lookup
function hexToRGBA(hex) {
    return ((parseInt(hex.slice(1, 3), 16) << 24) |
            (parseInt(hex.slice(3, 5), 16) << 16) |
            (parseInt(hex.slice(5, 7), 16) << 8) | 0xFF) >>> 0;
}

function rgbPack(r, g, b) {
    return ((r << 24) | (g << 16) | (b << 8) | 0xFF) >>> 0;
}

const XTERM_256_RGBA = XTERM_256_PALETTE.map(hexToRGBA);

// CSS color string cache (terminals use <50 distinct colors)
const _cssCache = new Map();
function rgbaToCSS(rgba) {
    let css = _cssCache.get(rgba);
    if (css !== undefined) return css;
    const r = (rgba >>> 24) & 0xFF;
    const g = (rgba >>> 16) & 0xFF;
    const b = (rgba >>> 8) & 0xFF;
    css = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    _cssCache.set(rgba, css);
    return css;
}

const ATTR = {
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
const DEC_SPECIAL_GRAPHICS = {
    '`': '◆', 'a': '▒', 'f': '°', 'g': '±', 'j': '┘', 'k': '┐',
    'l': '┌', 'm': '└', 'n': '┼', 'o': '⎺', 'p': '⎻', 'q': '─',
    'r': '⎼', 's': '⎽', 't': '├', 'u': '┤', 'v': '┴', 'w': '┬',
    'x': '│', 'y': '≤', 'z': '≥', '{': 'π', '|': '≠', '}': '£',
    '~': '·'
};

// Box Drawing segment table: index = codePoint - 0x2500
// Each entry: [left, right, up, down] where 0=none, 1=light, 2=heavy, 3=double
// null entries fall back to font glyph rendering
const BOX_DRAWING_SEGMENTS = [
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
            lineHeight: options.lineHeight || 0
        };

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'term-canvas';
        this.canvas.tabIndex = 0;
        this.container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d', { alpha: false });

        // Theme colors
        const theme = this.options.theme;
        this.colors = {
            background: theme.background || '#0a0a0a',
            foreground: theme.foreground || '#e0e0e0',
            cursor: theme.cursor || '#a78bfa',
            selection: theme.selection || 'rgba(167, 139, 250, 0.3)',
            palette: theme.palette || XTERM_256_PALETTE
        };

        // Precompute theme colors as RGBA uint32 for packed cell resolution
        this.themeFgRGBA = hexToRGBA(this.colors.foreground);
        this.themeBgRGBA = hexToRGBA(this.colors.background);

        // Terminal state
        this.cols = 80;
        this.rows = 24;
        this.charWidth = 0;
        this.charHeight = 0;
        this.lineHeight = this.options.lineHeight || 1.15;

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
        this.lastRenderTime = 0;
        this.lastFont = null;

        // Glyph availability cache: codePoint → boolean (true = renderable)
        this._glyphCache = new Map();
        // Pre-probe PUA range availability at init
        this._puaAvailable = false;

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
    // Initialization Helpers
    // -------------------------------------------------------------------------

    measureChar() {
        const fontSize = this.options.fontSize;
        this.ctx.font = `${fontSize}px ${this.options.fontFamily}`;
        const metrics = this.ctx.measureText('W');
        // Preserve fractional width for precise subpixel character placement
        this.charWidth = Math.max(4, metrics.width);
        this.charHeight = Math.max(14, Math.ceil(fontSize * this.lineHeight));

        // Invalidate tofu reference data so it's re-probed with current font
        this._tofuData = null;

        // Probe Private Use Area glyph availability (Powerline/Nerd Font symbols)
        this._glyphCache.clear();
        // Test a representative sample of PUA glyphs:
        //  U+E0B0 = Powerline right arrow (most common)
        //  U+E0A0 = Powerline branch symbol
        //  U+F001 = Nerd Font fa-music
        this._puaAvailable = this._probeGlyph('\uE0B0') ||
                             this._probeGlyph('\uE0A0') ||
                             this._probeGlyph('\uF001');
    }

    /**
     * Probe whether a glyph is renderable by the current font.
     * 
     * Uses a visual signature approach: renders the character on a tiny canvas
     * and detects the .notdef tofu pattern. Tofu glyphs are hollow rectangles
     * with pixels concentrated on edges. Real glyphs have complex internal 
     * pixel patterns.
     * 
     * As a fast-path, uses document.fonts.check() when available, but wraps
     * it with a secondary validation since generic families like 'monospace'
     * can falsely report support.
     */
    _probeGlyph(ch) {
        const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`;
        const size = Math.max(24, this.options.fontSize + 8);

        // Get the exact pixel signature of a known-missing glyph (U+FFFF)
        // This is guaranteed to be unassigned in Unicode, so it always renders
        // the system's native .notdef tofu glyph.
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

        // Render the actual test character
        const probe = document.createElement('canvas');
        probe.width = size; probe.height = size;
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        pctx.font = fontSpec;
        pctx.textBaseline = 'top';
        pctx.fillStyle = '#fff';
        pctx.fillText(ch, 2, 2);
        const testData = pctx.getImageData(0, 0, size, size).data;

        // Compare pixel-by-pixel against the tofu reference
        let diff = 0;
        let hasPixels = false;
        for (let i = 3; i < testData.length; i += 4) {
            if (testData[i] > 0) hasPixels = true;
            if (testData[i] !== this._tofuData[i]) diff++;
        }

        // If it perfectly matches the tofu signature, it's missing
        if (diff === 0 && hasPixels) return false;
        // No pixels at all — also missing
        if (!hasPixels) return false;
        return true;
    }

    /**
     * Check if a codepoint is renderable. Uses cached results for performance.
     * Private Use Area (U+E000–U+F8FF) is batch-checked via the _puaAvailable flag.
     */
    _isGlyphRenderable(cp) {
        // Standard ASCII + Latin + common scripts (Latin Extended, Greek, Cyrillic) — always renderable
        if (cp < 0x0530) return true;

        // CJK Unified Ideographs — typically available in system fonts
        if (cp >= 0x4E00 && cp <= 0x9FFF) return true;

        // Private Use Area (Powerline, Nerd Font, devicons)
        if (cp >= 0xE000 && cp <= 0xF8FF) return this._puaAvailable;

        // Supplementary PUA (Nerd Font Material Design icons, etc.)
        if (cp >= 0xF0000) return this._puaAvailable;

        // Check cache
        const cached = this._glyphCache.get(cp);
        if (cached !== undefined) return cached;

        // Probe and cache
        const renderable = this._probeGlyph(String.fromCodePoint(cp));
        this._glyphCache.set(cp, renderable);
        return renderable;
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
        const dpr = window.devicePixelRatio || 1;

        const pad = this.options.padding;

        const oldCols = this.cols;
        const oldRows = this.rows;
        this.cols = Math.max(1, Math.floor((rect.width - pad * 2) / this.charWidth));
        this.rows = Math.max(1, Math.floor((rect.height - pad * 2) / this.charHeight));
        this.scrollBottom = 0;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.lastFont = null;

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

        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);
        const pad = this.options.padding;

        this.ctx.fillStyle = this.colors.background;
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.save();
        this.ctx.translate(pad, pad);
        // Invalidate font cache: ctx.restore() at end of each frame resets
        // the canvas font, so lastFont from the previous frame is stale
        this.lastFont = null;

        const scrollbackVisible = this.scrollbackOffset > 0 && !this.useAlternate;

        // Collect all visible rows: { grid, gridCols, gridY, screenY }
        const visibleRows = [];

        if (scrollbackVisible) {
            const scrollbackStart = Math.max(0, this.scrollbackBuffer.length - this.scrollbackOffset);
            const scrollbackRows = Math.min(this.scrollbackOffset, this.rows);
            for (let i = 0; i < scrollbackRows; i++) {
                const idx = scrollbackStart + i;
                if (idx < this.scrollbackBuffer.length) {
                    const sbRow = this.scrollbackBuffer[idx];
                    visibleRows.push({ grid: sbRow, gridCols: sbRow.length / CELL_WORDS, gridY: 0, screenY: i });
                }
            }
            const startRow = scrollbackRows;
            for (let y = 0; y < this.rows - startRow && y + startRow < this.rows; y++) {
                visibleRows.push({ grid: this.grid, gridCols: this.cols, gridY: y, screenY: startRow + y });
            }
        } else {
            for (let y = 0; y < this.rows; y++) {
                visibleRows.push({ grid: this.grid, gridCols: this.cols, gridY: y, screenY: y });
            }
        }

        // GLOBAL PASS 1: Draw ALL backgrounds first
        for (const vr of visibleRows) {
            this.renderRowBg(vr.grid, vr.gridCols, vr.gridY, vr.screenY);
        }

        // GLOBAL PASS 2: Draw ALL text and decorations on top
        for (const vr of visibleRows) {
            this.renderRowText(vr.grid, vr.gridCols, vr.gridY, vr.screenY);
        }

        if (this.selection) this.renderSelection();
        if (this.cursorVisible && this.focused) this.renderCursor();

        this.ctx.restore();
    }

    // ── Color resolution helpers ────────────────────────────────────────────

    _resolveBgRGBA(word0, fgRGBA, bgRGBA) {
        const flags = word0 & CELL_FLAGS_MASK;
        if (flags & ATTR.INVERSE) {
            return fgRGBA === COLOR_DEFAULT ? this.themeFgRGBA : fgRGBA;
        }
        return bgRGBA === COLOR_DEFAULT ? this.themeBgRGBA : bgRGBA;
    }

    _resolveFgRGBA(word0, fgRGBA, bgRGBA) {
        const flags = word0 & CELL_FLAGS_MASK;
        if (flags & ATTR.INVERSE) {
            return bgRGBA === COLOR_DEFAULT ? this.themeBgRGBA : bgRGBA;
        }
        return fgRGBA === COLOR_DEFAULT ? this.themeFgRGBA : fgRGBA;
    }

    renderRowBg(grid, gridCols, gridY, screenY) {
        const baseline = screenY * this.charHeight;
        const rowOffset = gridY * gridCols * CELL_WORDS;
        const renderCols = Math.min(gridCols, this.cols);

        let bgStart = 0;
        let off = rowOffset;
        let currentBg = this._resolveBgRGBA(grid[off], grid[off + 1], grid[off + 2]);

        for (let col = 1; col <= renderCols; col++) {
            let cellBg;
            if (col < renderCols) {
                off = rowOffset + col * CELL_WORDS;
                cellBg = this._resolveBgRGBA(grid[off], grid[off + 1], grid[off + 2]);
            } else {
                cellBg = ~currentBg >>> 0; // force flush
            }
            if (cellBg !== currentBg) {
                this.ctx.fillStyle = rgbaToCSS(currentBg);
                this.ctx.fillRect(bgStart * this.charWidth, baseline, (col - bgStart) * this.charWidth, this.charHeight);
                bgStart = col;
                currentBg = cellBg;
            }
        }
    }

    renderRowText(grid, gridCols, gridY, screenY) {
        const baseline = screenY * this.charHeight;
        const rowOffset = gridY * gridCols * CELL_WORDS;
        const renderCols = Math.min(gridCols, this.cols);

        let runStart = 0;
        let off = rowOffset;
        let currentFg = grid[off + 1];
        let currentBg = grid[off + 2];
        let currentFlags = grid[off] & CELL_FLAGS_MASK;

        for (let col = 1; col <= renderCols; col++) {
            let fg, bg, flags;
            if (col < renderCols) {
                off = rowOffset + col * CELL_WORDS;
                fg = grid[off + 1];
                bg = grid[off + 2];
                flags = grid[off] & CELL_FLAGS_MASK;
            } else {
                fg = ~currentFg >>> 0; // force flush
                bg = 0;
                flags = 0;
            }
            if (fg !== currentFg || bg !== currentBg || flags !== currentFlags) {
                if (col > runStart) {
                    this.renderRunText(grid, gridCols, gridY, runStart, col - runStart, baseline, currentFg, currentBg, currentFlags);
                }
                runStart = col;
                currentFg = fg;
                currentBg = bg;
                currentFlags = flags;
            }
        }
    }

    renderRunText(grid, gridCols, gridY, startX, length, baseline, fgRGBA, bgRGBA, flags) {
        // Backgrounds are already drawn in renderRowBg pass
        const rowOffset = gridY * gridCols * CELL_WORDS;

        // Check for non-space content
        let hasContent = false;
        for (let x = startX; x < startX + length; x++) {
            const cp = grid[rowOffset + x * CELL_WORDS] >>> CELL_CP_SHIFT;
            if (cp !== SPACE_CP && cp !== 0) {
                hasContent = true;
                break;
            }
        }

        if (!hasContent && !(flags & (ATTR.UNDERLINE | ATTR.DOUBLE_UNDERLINE | ATTR.STRIKETHROUGH))) {
            return;
        }

        // Text color — resolve via RGBA helpers
        const textColorRGBA = this._resolveFgRGBA(flags, fgRGBA, bgRGBA);
        const textColor = rgbaToCSS(textColorRGBA);
        this.ctx.fillStyle = textColor;

        // Font style
        const fontParts = [];
        if (flags & ATTR.BOLD) fontParts.push('bold');
        if (flags & ATTR.ITALIC) fontParts.push('italic');
        fontParts.push(`${this.options.fontSize}px`);
        fontParts.push(this.options.fontFamily);
        const fontString = fontParts.join(' ');

        if (this.lastFont !== fontString) {
            this.ctx.font = fontString;
            this.lastFont = fontString;
        }
        this.ctx.textBaseline = 'top';

        // Render each character at its exact cell position to prevent drift
        for (let i = 0; i < length; i++) {
            const off = rowOffset + (startX + i) * CELL_WORDS;
            const cp = grid[off] >>> CELL_CP_SHIFT;
            if (cp === SPACE_CP || cp === 0) continue;
            const cx = (startX + i) * this.charWidth;
            // Programmatic rendering for block elements, box drawing, and braille
            if (cp >= 0x2500 && this.renderSpecialChar(cp, cx, baseline, textColor)) continue;
            // Skip unrenderable glyphs (tofu prevention)
            if (!this._isGlyphRenderable(cp)) continue;
            this.ctx.fillText(String.fromCodePoint(cp), cx, baseline);
        }

        // Underline
        if (flags & ATTR.UNDERLINE) {
            this.ctx.strokeStyle = textColor;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.stroke();
        }

        // Double underline
        if (flags & ATTR.DOUBLE_UNDERLINE) {
            this.ctx.strokeStyle = textColor;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight - 4);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight - 4);
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.stroke();
        }

        // Strikethrough
        if (flags & ATTR.STRIKETHROUGH) {
            this.ctx.strokeStyle = textColor;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight / 2);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight / 2);
            this.ctx.stroke();
        }
    }

    // -------------------------------------------------------------------------
    // Programmatic Unicode Character Rendering
    // -------------------------------------------------------------------------

    renderSpecialChar(code, x, y, color) {
        if (code >= 0x2580 && code <= 0x259F) return this.renderBlockChar(code, x, y, color);
        if (code >= 0x2500 && code <= 0x257F) return this.renderBoxDrawing(code, x, y, color);
        if (code >= 0x2800 && code <= 0x28FF) return this.renderBraille(code, x, y, color);
        return false;
    }

    renderBlockChar(code, x, y, color) {
        const w = this.charWidth;
        const h = this.charHeight;
        this.ctx.fillStyle = color;

        // Full block U+2588 (+0.5px overdraw to crush subpixel seams)
        if (code === 0x2588) { this.ctx.fillRect(x, y, w + 0.5, h + 0.5); return true; }

        // Upper half block U+2580
        if (code === 0x2580) { this.ctx.fillRect(x, y, w + 0.5, Math.ceil(h / 2)); return true; }

        // Lower blocks U+2581-U+2587 (1/8 to 7/8 from bottom)
        if (code >= 0x2581 && code <= 0x2587) {
            const frac = (code - 0x2580) / 8;
            const bh = Math.round(h * frac);
            this.ctx.fillRect(x, y + h - bh, w + 0.5, bh + 0.5);
            return true;
        }

        // Left blocks U+2589-U+258F (7/8 to 1/8 from left)
        if (code >= 0x2589 && code <= 0x258F) {
            const frac = (0x2590 - code) / 8;
            this.ctx.fillRect(x, y, Math.round(w * frac) + 0.5, h + 0.5);
            return true;
        }

        // Right half block U+2590
        if (code === 0x2590) {
            const hw = Math.floor(w / 2);
            this.ctx.fillRect(x + hw, y, w - hw + 0.5, h + 0.5);
            return true;
        }

        // Shade characters U+2591-U+2593
        if (code >= 0x2591 && code <= 0x2593) {
            const alpha = [0.25, 0.50, 0.75][code - 0x2591];
            this.ctx.globalAlpha = alpha;
            this.ctx.fillRect(x, y, w + 0.5, h + 0.5);
            this.ctx.globalAlpha = 1;
            return true;
        }

        // Upper one-eighth block U+2594
        if (code === 0x2594) { this.ctx.fillRect(x, y, w, Math.max(1, Math.round(h / 8))); return true; }

        // Right one-eighth block U+2595
        if (code === 0x2595) {
            const ew = Math.max(1, Math.round(w / 8));
            this.ctx.fillRect(x + w - ew, y, ew, h);
            return true;
        }

        // Quadrant characters U+2596-U+259F
        if (code >= 0x2596 && code <= 0x259F) {
            const masks = [
                0b0010, 0b0001, 0b1000, 0b1011, 0b1001, // 2596-259A
                0b1110, 0b1101, 0b0100, 0b0110, 0b0111  // 259B-259F
            ];
            const mask = masks[code - 0x2596];
            const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
            if (mask & 8) this.ctx.fillRect(x, y, hw, hh);
            if (mask & 4) this.ctx.fillRect(x + hw, y, w - hw, hh);
            if (mask & 2) this.ctx.fillRect(x, y + hh, hw, h - hh);
            if (mask & 1) this.ctx.fillRect(x + hw, y + hh, w - hw, h - hh);
            return true;
        }

        return false;
    }

    renderBoxDrawing(code, x, y, color) {
        const idx = code - 0x2500;
        if (idx < 0 || idx >= BOX_DRAWING_SEGMENTS.length) return false;
        const seg = BOX_DRAWING_SEGMENTS[idx];
        if (!seg) return false;

        const [lw, rw, uw, dw] = seg;
        const w = this.charWidth;
        const h = this.charHeight;
        const mx = x + Math.floor(w / 2);
        const my = y + Math.floor(h / 2);
        const thin = 1;
        const thick = Math.max(2, Math.round(w / 5));
        const gap = Math.max(2, Math.round(Math.min(w, h) * 0.3));

        this.ctx.fillStyle = color;

        const hLine = (x1, x2, cy, wt) => {
            if (wt === 1) this.ctx.fillRect(x1, cy, x2 - x1, thin);
            else if (wt === 2) this.ctx.fillRect(x1, cy - Math.floor(thick / 2), x2 - x1, thick);
            else if (wt === 3) {
                this.ctx.fillRect(x1, cy - gap, x2 - x1, thin);
                this.ctx.fillRect(x1, cy + gap, x2 - x1, thin);
            }
        };
        const vLine = (y1, y2, cx, wt) => {
            if (wt === 1) this.ctx.fillRect(cx, y1, thin, y2 - y1);
            else if (wt === 2) this.ctx.fillRect(cx - Math.floor(thick / 2), y1, thick, y2 - y1);
            else if (wt === 3) {
                this.ctx.fillRect(cx - gap, y1, thin, y2 - y1);
                this.ctx.fillRect(cx + gap, y1, thin, y2 - y1);
            }
        };

        if (lw) hLine(x, mx + thin, my, lw);
        if (rw) hLine(mx, x + w, my, rw);
        if (uw) vLine(y, my + thin, mx, uw);
        if (dw) vLine(my, y + h, mx, dw);

        return true;
    }

    renderBraille(code, x, y, color) {
        const bits = code - 0x2800;
        if (bits === 0) return true; // blank braille
        const w = this.charWidth;
        const h = this.charHeight;
        const dotW = Math.max(1, Math.round(w * 0.2));
        const dotH = Math.max(1, Math.round(h * 0.1));
        const cx1 = x + Math.round(w * 0.3);
        const cx2 = x + Math.round(w * 0.7);
        const rows = [0.15, 0.35, 0.55, 0.75];
        // Bit layout: dots 1-8 map to bits 0-7
        // Col 1: bits 0,1,2,6  Col 2: bits 3,4,5,7
        const dotMap = [
            [0, cx1], [1, cx1], [2, cx1], [6, cx1],
            [3, cx2], [4, cx2], [5, cx2], [7, cx2]
        ];
        this.ctx.fillStyle = color;
        for (let i = 0; i < 8; i++) {
            const [bit, dx] = dotMap[i];
            if (bits & (1 << bit)) {
                const dy = y + Math.round(h * rows[i % 4]);
                this.ctx.fillRect(dx - Math.floor(dotW / 2), dy - Math.floor(dotH / 2), dotW, dotH);
            }
        }
        return true;
    }

    // getColor is no longer needed — colors are resolved via _resolveFgRGBA/_resolveBgRGBA + rgbaToCSS

    renderCursor() {
        const x = this.cursorX * this.charWidth;
        const y = this.cursorY * this.charHeight;
        const adjustedY = y - (this.scrollbackOffset * this.charHeight);

        if (adjustedY < 0 || adjustedY >= this.canvas.height / (window.devicePixelRatio || 1)) return;
        if (!this.cursorBlinkState && this.options.cursorBlink) return;

        this.ctx.fillStyle = this.colors.cursor;

        switch (this.options.cursorStyle) {
            case 'underline':
                this.ctx.fillRect(x, adjustedY + this.charHeight - 3, this.charWidth, 3);
                break;
            case 'bar':
                this.ctx.fillRect(x, adjustedY, 2, this.charHeight);
                break;
            case 'block':
            default:
                if (this.cursorBlinkState) {
                    this.ctx.fillRect(x, adjustedY, this.charWidth, this.charHeight);
                    // Decode character under cursor from packed grid
                    const off = (this.cursorY * this.cols + this.cursorX) * CELL_WORDS;
                    const word0 = this.grid[off];
                    const cp = word0 >>> CELL_CP_SHIFT;
                    const cellFlags = word0 & CELL_FLAGS_MASK;
                    if (cp !== SPACE_CP && cp !== 0) {
                        this.ctx.fillStyle = this.colors.background;
                        // Build font string respecting cell's SGR flags (bold/italic)
                        const cursorFontParts = [];
                        if (cellFlags & ATTR.BOLD) cursorFontParts.push('bold');
                        if (cellFlags & ATTR.ITALIC) cursorFontParts.push('italic');
                        cursorFontParts.push(`${this.options.fontSize}px`);
                        cursorFontParts.push(this.options.fontFamily);
                        this.ctx.font = cursorFontParts.join(' ');
                        this.ctx.textBaseline = 'top';
                        this.ctx.fillText(String.fromCodePoint(cp), x, adjustedY);
                    }
                    // Invalidate font cache — renderCursor changed ctx.font
                    // without going through the renderRunText caching path
                    this.lastFont = null;
                }
                break;
        }
    }

    renderSelection() {
        if (!this.selection) return;
        const { startRow, endRow, startCol, endCol } = this.selection;
        for (let y = startRow; y <= endRow; y++) {
            let x1 = y === startRow ? startCol : 0;
            let x2 = y === endRow ? endCol : this.cols;
            if (x1 < x2) {
                this.ctx.fillStyle = this.colors.selection;
                this.ctx.fillRect(x1 * this.charWidth, y * this.charHeight, (x2 - x1) * this.charWidth, this.charHeight);
            }
        }
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
                    if (e.ctrlKey && e.key.length === 1) {
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
