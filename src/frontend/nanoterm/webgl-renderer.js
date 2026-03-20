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

        float cx = 0.5;
        float cy = 0.5;
        float thinW = 1.0 / u_charSize.x;    // 1px line width in UV
        float thinH = 1.0 / u_charSize.y;
        float thickW = max(2.0, u_charSize.x * 0.2) / u_charSize.x;
        float thickH = max(2.0, u_charSize.y * 0.2) / u_charSize.y;
        float gapW = max(2.0, u_charSize.x * 0.3) / u_charSize.x;
        float gapH = max(2.0, u_charSize.y * 0.3) / u_charSize.y;

        bool hit = false;

        // Horizontal segments
        // Left segment
        if (lw > 0u && localUV.x <= cx + thinW) {
            if (lw == 1u && abs(localUV.y - cy) < thinH * 0.5) hit = true;
            if (lw == 2u && abs(localUV.y - cy) < thickH * 0.5) hit = true;
            if (lw == 3u && (abs(localUV.y - cy - gapH) < thinH * 0.5 || abs(localUV.y - cy + gapH) < thinH * 0.5)) hit = true;
        }
        // Right segment
        if (rw > 0u && localUV.x >= cx) {
            if (rw == 1u && abs(localUV.y - cy) < thinH * 0.5) hit = true;
            if (rw == 2u && abs(localUV.y - cy) < thickH * 0.5) hit = true;
            if (rw == 3u && (abs(localUV.y - cy - gapH) < thinH * 0.5 || abs(localUV.y - cy + gapH) < thinH * 0.5)) hit = true;
        }
        // Up segment
        if (uw > 0u && localUV.y <= cy + thinH) {
            if (uw == 1u && abs(localUV.x - cx) < thinW * 0.5) hit = true;
            if (uw == 2u && abs(localUV.x - cx) < thickW * 0.5) hit = true;
            if (uw == 3u && (abs(localUV.x - cx - gapW) < thinW * 0.5 || abs(localUV.x - cx + gapW) < thinW * 0.5)) hit = true;
        }
        // Down segment
        if (dw > 0u && localUV.y >= cy) {
            if (dw == 1u && abs(localUV.x - cx) < thinW * 0.5) hit = true;
            if (dw == 2u && abs(localUV.x - cx) < thickW * 0.5) hit = true;
            if (dw == 3u && (abs(localUV.x - cx - gapW) < thinW * 0.5 || abs(localUV.x - cx + gapW) < thinW * 0.5)) hit = true;
        }

        if (hit) color = fgColor;
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
        // Skip special characters (rendered procedurally)
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
