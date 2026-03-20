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
