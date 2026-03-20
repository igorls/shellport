# Rendering Fidelity & Bug Hunt Review — NanoTermV2 WebGL Renderer (Round 2)

## Project Context

NanoTermV2 is a zero-dependency, GPU-accelerated terminal emulator in vanilla JavaScript. It renders to `<canvas>` using WebGL2 with automatic fallback to Canvas2D. The project is split into ES modules bundled via Bun at build time.

**Architecture:**
- `index.js` — Full VT100/xterm emulator core (SGR, CSI, OSC, DCS, scrollback, selection, clipboard, cursor)
- `webgl-renderer.js` — WebGL2 primary renderer: full-screen quad, GLSL fragment shader, RGBA32UI data textures, dynamic glyph atlas, procedural box drawing / braille / block chars
- `canvas-renderer.js` — Canvas2D fallback renderer
- `constants.js` — Shared constants including the `BOX_DRAWING_SEGMENTS` table

**Critical context:** The WebGL renderer was **never actually running** until this session. A null crash in `_uploadBoxTexture()` (null entries in `BOX_DRAWING_SEGMENTS` for rounded corners) silently fell back to Canvas2D. This means the WebGL shader code has had zero real-world testing until now.

## Review Scope

Round 2 focused stability + correctness review. The renderer now initializes successfully but has visible rendering artifacts:

1. **Rounded corner arcs (╭╮╯╰)** do not connect seamlessly with adjacent straight box-drawing segments at cell edge midpoints. The current pixel-space arc SDF uses `radius = min(halfW, halfH)` but terminal cells are non-square (typically ~8×17 pixels), so the arc endpoint doesn't land at (0.5, 0) or (0, 0.5) of the adjacent cell boundary.
2. **Double-line box drawing** corners appear to render incorrectly
3. Clipboard and input handling was broken (fixed but needs validation)

## Attached Context Packs

| File | Contents | Token Estimate |
|------|----------|----------------|
| `context_full.md` | Complete NanoTermV2 source: `index.js` (emulator core), `webgl-renderer.js` (WebGL2 renderer), `canvas-renderer.js` (Canvas2D fallback), `constants.js` (box drawing table) | ~25K |

## Focus Areas

### 1. Rounded Corner Arc SDF Geometry (HIGHEST PRIORITY)

The current shader code for ╭╮╯╰ uses:
```glsl
vec2 px = localUV * u_charSize;  // pixel position
float halfW = u_charSize.x * 0.5;
float halfH = u_charSize.y * 0.5;
// center at opposite corner, e.g. for ╭: center = u_charSize (bottom-right)
float radius = min(halfW, halfH);
if (abs(dist - radius) < 0.8) hit = true;
```

**The problem:** With non-square cells (e.g. 8px × 17px), `min(halfW, halfH) = 4`, so the arc is a circle of radius 4px centered at (8, 17). This circle:
- Reaches X=4 at Y≈17 ✓ (connects to the horizontal line at cell right-edge midpoint... wait, it's a circle, so at Y=17 it's at X=8±4, meaning X=4 and X=12... but X=4 is the midpoint at `localUV.x=0.5` ✓)
- At X=0: it reaches Y=17-sqrt(16-64)... imaginary → the arc never reaches the vertical line at Y midpoint!

**The arc cannot connect both edges with a circular radius when cells are non-square.** This is the fundamental geometry bug. Review and suggest the correct approach. Consider:
- Elliptical arc instead of circular
- Remapping to UV space with aspect-correction
- Using `halfW` for the horizontal radius and `halfH` for the vertical radius

### 2. Box Drawing Segment Rendering
- Is the `BOX_DRAWING_SEGMENTS` table complete and correct for all codepoints 0x2500–0x257F?
- Do null entries correctly map to procedural rendering in the shader?
- Are the hit-test thresholds for thin (1) vs thick (2) weight correct?
- Do segments connect exactly at cell edge midpoints with no sub-pixel gaps?

### 3. Texture Upload & Data Packing
- Is the `_buildGridData()` packing correct? Check bit-field extraction in shader vs JavaScript encoding
- Are atlas UV coordinates computed correctly? Watch for off-by-one in `texelFetch`
- Is `_uploadBoxTexture()` encoding the segment weights correctly in RGBA32UI channels?
- Any precision issues with float/int conversions?

### 4. Performance
- `_buildGridData()` iterates entire grid every frame — could dirty-region tracking help?
- Atlas texture grows but never shrinks — memory leak in long sessions?
- `requestAnimationFrame` loop runs even when nothing changes
- Any unnecessary texture re-uploads?

### 5. Renderer Interface Parity
- What features does CanvasRenderer support that WebGLRenderer is missing?
- Is `measureChar()` consistent between renderers?
- Are cursor, selection overlay, underline/strikethrough equivalent?
- Does DPI/devicePixelRatio handling match?

### 6. Clipboard & Input
- Ctrl+C: copies when selection exists, sends ^C otherwise — is the logic correct for all edge cases?
- Ctrl+Shift+C: always copies — does it work with empty selection?
- Right-click context menu: null guard added — is there a better pattern?
- Does `getSelection()` correctly decode all codepoints from the packed `Uint32Array`?

## Output Format

For each finding:

- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **File**: filename and line numbers
- **Category**: which focus area (1-6)
- **Description**: what the issue is
- **Impact**: what the user sees or what breaks
- **Suggested Fix**: concrete code-level recommendation

Group findings by severity. End with: total counts, top 3 issues, overall assessment of production-readiness.
