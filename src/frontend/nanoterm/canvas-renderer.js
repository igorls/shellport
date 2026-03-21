// ═══════════════════════════════════════════════════════════════════════════
// CanvasRenderer — Canvas2D rendering backend
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

export class CanvasRenderer {
    constructor(container, options, colors) {
        this.options = options;
        this.colors = colors;
        this.charWidth = 0;
        this.charHeight = 0;
        this.lastFont = null;

        // Theme RGBA for packed cell resolution
        this.themeFgRGBA = hexToRGBA(colors.foreground);
        this.themeBgRGBA = hexToRGBA(colors.background);

        // Glyph availability cache
        this._glyphCache = new Map();
        this._puaAvailable = false;
        this._tofuData = null;

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'term-canvas';
        this.canvas.tabIndex = 0;
        container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d', { alpha: false });
    }

    // ── Font Measurement ────────────────────────────────────────────────────

    measureChar() {
        const testCanvas = document.createElement('canvas');
        const testCtx = testCanvas.getContext('2d');
        const fontSize = this.options.fontSize;
        testCtx.font = `${fontSize}px ${this.options.fontFamily}`;
        const m = testCtx.measureText('W');
        this.charWidth = Math.ceil(m.width);
        const lineHeight = this.options.lineHeight || 1.15;
        this.charHeight = Math.ceil(fontSize * lineHeight);

        // Invalidate tofu reference data so it's re-probed with current font
        this._tofuData = null;
        this._glyphCache.clear();
        this._puaAvailable = this._probeGlyph('\uE0B0') ||
                             this._probeGlyph('\uE0A0') ||
                             this._probeGlyph('\uF001');
    }

    // ── Glyph Availability ──────────────────────────────────────────────────

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

    // ── Resize ──────────────────────────────────────────────────────────────

    resizeCanvas(containerRect) {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = containerRect.width * dpr;
        this.canvas.height = containerRect.height * dpr;
        this.canvas.style.width = containerRect.width + 'px';
        this.canvas.style.height = containerRect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.lastFont = null;
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

    // ── Main Render ─────────────────────────────────────────────────────────

    render(term) {
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);
        const pad = this.options.padding;

        this.ctx.fillStyle = this.colors.background;
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.save();
        this.ctx.translate(pad, pad);
        this.lastFont = null;

        const scrollbackVisible = term.scrollbackOffset > 0 && !term.useAlternate;

        const visibleRows = [];

        if (scrollbackVisible) {
            const scrollbackStart = Math.max(0, term.scrollbackBuffer.length - term.scrollbackOffset);
            const scrollbackRows = Math.min(term.scrollbackOffset, term.rows);
            for (let i = 0; i < scrollbackRows; i++) {
                const idx = scrollbackStart + i;
                if (idx < term.scrollbackBuffer.length) {
                    const sbRow = term.scrollbackBuffer[idx];
                    visibleRows.push({ grid: sbRow, gridCols: sbRow.length / CELL_WORDS, gridY: 0, screenY: i });
                }
            }
            const startRow = scrollbackRows;
            for (let y = 0; y < term.rows - startRow && y + startRow < term.rows; y++) {
                visibleRows.push({ grid: term.grid, gridCols: term.cols, gridY: y, screenY: startRow + y });
            }
        } else {
            for (let y = 0; y < term.rows; y++) {
                visibleRows.push({ grid: term.grid, gridCols: term.cols, gridY: y, screenY: y });
            }
        }

        for (const vr of visibleRows) {
            this.renderRowBg(vr.grid, vr.gridCols, vr.gridY, vr.screenY);
        }

        for (const vr of visibleRows) {
            this.renderRowText(vr.grid, vr.gridCols, vr.gridY, vr.screenY);
        }

        if (term.selection) this.renderSelection(term);
        if (term.cursorVisible && term.focused) this.renderCursor(term);

        this.ctx.restore();
    }

    // ── Row Rendering ───────────────────────────────────────────────────────

    renderRowBg(grid, gridCols, gridY, screenY) {
        const baseline = screenY * this.charHeight;
        const rowOffset = gridY * gridCols * CELL_WORDS;
        const renderCols = Math.min(gridCols, this._renderCols || gridCols);

        let bgStart = 0;
        let off = rowOffset;
        let currentBg = this._resolveBgRGBA(grid[off], grid[off + 1], grid[off + 2]);

        for (let col = 1; col <= renderCols; col++) {
            let cellBg;
            if (col < renderCols) {
                off = rowOffset + col * CELL_WORDS;
                cellBg = this._resolveBgRGBA(grid[off], grid[off + 1], grid[off + 2]);
            } else {
                cellBg = ~currentBg >>> 0;
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
        const renderCols = Math.min(gridCols, this._renderCols || gridCols);

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
                fg = ~currentFg >>> 0;
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
        const rowOffset = gridY * gridCols * CELL_WORDS;

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

        const textColorRGBA = this._resolveFgRGBA(flags, fgRGBA, bgRGBA);
        const textColor = rgbaToCSS(textColorRGBA);
        this.ctx.fillStyle = textColor;

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

        for (let i = 0; i < length; i++) {
            const off = rowOffset + (startX + i) * CELL_WORDS;
            const cp = grid[off] >>> CELL_CP_SHIFT;
            if (cp === SPACE_CP || cp === 0) continue;
            const cx = (startX + i) * this.charWidth;
            if (cp >= 0x2500 && this.renderSpecialChar(cp, cx, baseline, textColor)) continue;
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

    // ── Special Characters ──────────────────────────────────────────────────

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

        if (code === 0x2588) { this.ctx.fillRect(x, y, w + 0.5, h + 0.5); return true; }
        if (code === 0x2580) { this.ctx.fillRect(x, y, w + 0.5, Math.ceil(h / 2)); return true; }
        if (code >= 0x2581 && code <= 0x2587) {
            const frac = (code - 0x2580) / 8;
            const bh = Math.round(h * frac);
            this.ctx.fillRect(x, y + h - bh, w + 0.5, bh + 0.5);
            return true;
        }
        if (code >= 0x2589 && code <= 0x258F) {
            const frac = (0x2590 - code) / 8;
            this.ctx.fillRect(x, y, Math.round(w * frac) + 0.5, h + 0.5);
            return true;
        }
        if (code === 0x2590) {
            const hw = Math.floor(w / 2);
            this.ctx.fillRect(x + hw, y, w - hw + 0.5, h + 0.5);
            return true;
        }
        if (code >= 0x2591 && code <= 0x2593) {
            const alpha = [0.25, 0.50, 0.75][code - 0x2591];
            this.ctx.globalAlpha = alpha;
            this.ctx.fillRect(x, y, w + 0.5, h + 0.5);
            this.ctx.globalAlpha = 1;
            return true;
        }
        if (code === 0x2594) { this.ctx.fillRect(x, y, w, Math.max(1, Math.round(h / 8))); return true; }
        if (code === 0x2595) {
            const ew = Math.max(1, Math.round(w / 8));
            this.ctx.fillRect(x + w - ew, y, ew, h);
            return true;
        }
        if (code >= 0x2596 && code <= 0x259F) {
            const masks = [
                0b0010, 0b0001, 0b1000, 0b1011, 0b1001,
                0b1110, 0b1101, 0b0100, 0b0110, 0b0111
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
        if (bits === 0) return true;
        const w = this.charWidth;
        const h = this.charHeight;
        const dotW = Math.max(1, Math.round(w * 0.2));
        const dotH = Math.max(1, Math.round(h * 0.1));
        const cx1 = x + Math.round(w * 0.3);
        const cx2 = x + Math.round(w * 0.7);
        const rows = [0.15, 0.35, 0.55, 0.75];
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

    // ── Cursor & Selection ──────────────────────────────────────────────────

    renderCursor(term) {
        const x = term.cursorX * this.charWidth;
        const y = term.cursorY * this.charHeight;
        const adjustedY = y - (term.scrollbackOffset * this.charHeight);

        if (adjustedY < 0 || adjustedY >= this.canvas.height / (window.devicePixelRatio || 1)) return;
        if (!term.cursorBlinkState && this.options.cursorBlink) return;

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
                if (term.cursorBlinkState) {
                    this.ctx.fillRect(x, adjustedY, this.charWidth, this.charHeight);
                    const off = (term.cursorY * term.cols + term.cursorX) * CELL_WORDS;
                    const word0 = term.grid[off];
                    const cp = word0 >>> CELL_CP_SHIFT;
                    const cellFlags = word0 & CELL_FLAGS_MASK;
                    if (cp !== SPACE_CP && cp !== 0) {
                        this.ctx.fillStyle = this.colors.background;
                        const cursorFontParts = [];
                        if (cellFlags & ATTR.BOLD) cursorFontParts.push('bold');
                        if (cellFlags & ATTR.ITALIC) cursorFontParts.push('italic');
                        cursorFontParts.push(`${this.options.fontSize}px`);
                        cursorFontParts.push(this.options.fontFamily);
                        this.ctx.font = cursorFontParts.join(' ');
                        this.ctx.textBaseline = 'top';
                        this.ctx.fillText(String.fromCodePoint(cp), x, adjustedY);
                    }
                    this.lastFont = null;
                }
                break;
        }
    }

    renderSelection(term) {
        if (!term.selection) return;
        const { startRow, endRow, startCol, endCol } = term.selection;
        for (let y = startRow; y <= endRow; y++) {
            let x1 = y === startRow ? startCol : 0;
            let x2 = y === endRow ? endCol : term.cols;
            if (x1 < x2) {
                this.ctx.fillStyle = this.colors.selection;
                this.ctx.fillRect(x1 * this.charWidth, y * this.charHeight, (x2 - x1) * this.charWidth, this.charHeight);
            }
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    updateTheme(colors) {
        this.colors = colors;
        this.themeFgRGBA = hexToRGBA(colors.foreground);
        this.themeBgRGBA = hexToRGBA(colors.background);
    }

    destroy() {
        if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
}
