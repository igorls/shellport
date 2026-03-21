# Pixel-Perfect Arc Rendering & Font Resize Stability — Round 3

## Project Context

NanoTermV2 is a zero-dependency WebGL2 terminal emulator rendering to `<canvas>`. The WebGL renderer uses a full-screen quad fragment shader with RGBA32UI data textures and a dynamic glyph atlas. Box-drawing characters (U+2500–U+257F) are rendered procedurally in the shader.

In Round 2, we replaced the circular arc SDF with an elliptical arc using algebraic distance (`|f|/|∇f|`). The quadrant assignments were also corrected. However, the rendering still has visible problems.

## Attached Context Packs

| File | Contents | Tokens |
|------|----------|--------|
| `context_full.md` | Full NanoTermV2 source: `index.js`, `webgl-renderer.js`, `canvas-renderer.js`, `constants.js` | ~25K |

## Problem 1: Arc Aliasing & Corner Gaps

Screenshots show the rounded corner arcs at default font size (14px) and enlarged (zoomed in browser):
- The arc line is **not anti-aliased** — it uses a hard `if (dist < 0.5) hit = true` threshold producing visible staircase artifacts
- The arc endpoints **don't precisely meet** the straight segment endpoints at cell edge midpoints, leaving subtle gaps visible especially at larger font sizes
- The straight box-drawing segments (U+2500 horizontal, U+2502 vertical) use `thinH * 0.5 + 0.001` as their half-width, but the arc uses a different thickness model (`dist < 0.5`), so there's a **thickness mismatch** at the junction

The current shader code for rounded corners (find `0x256D` in `webgl-renderer.js`):
```glsl
if (inQuadrant) {
    vec2 d = px - center;
    float f = (d.x*d.x)/(cx*cx) + (d.y*d.y)/(cy*cy) - 1.0;
    vec2 grad = vec2(2.0*d.x/(cx*cx), 2.0*d.y/(cy*cy));
    float dist = abs(f) / length(grad);
    if (dist < 0.5) hit = true;
}
```

### What needs to be fixed:
1. **Anti-aliasing**: Use `smoothstep` instead of a hard threshold to produce sub-pixel blending at arc edges
2. **Thickness matching**: The arc stroke width must exactly match the straight segment thickness (which uses `thinH` / `thinW` values computed as `1.0 / u_charSize.y` and `1.0 / u_charSize.x`)
3. **Junction precision**: The ellipse must pass exactly through the cell edge midpoints `(cx, 0)`, `(cx, charH)`, `(0, cy)`, `(charW, cy)` — verify the math guarantees this

## Problem 2: Font Size Change Breaks Rendering

The test page now has font size controls (−/+ buttons). When changing font size:
- The terminal is destroyed and recreated with a new `NanoTermV2` instance
- The glyph atlas, grid texture, and WebGL resources are recreated
- However, **rendering breaks** after font size change — unclear what specifically, but the user reported issues

### What needs to be fixed:
1. Review the `destroy()` method in WebGLRenderer — does it properly clean up ALL GL resources?
2. Review how `measureChar()` and `_resetAtlas()` behave when the renderer is recreated
3. Check if the cached `_gridData` array (added in Round 2 Fix #5) could be stale across recreations
4. Check if `_atlasDpr`, `_atlasCharW`, `_atlasCharH` are properly initialized on recreation

## Problem 3: Straight Segment Thickness Model

The current straight-line box drawing uses `thinH` and `thinW` (1 pixel in UV space) with an additional `+ 0.001` fudge factor. Review whether:
1. The `+ 0.001` epsilon is appropriate or causes visual artifacts
2. The thickness model for weight=1 (thin), weight=2 (thick), weight=3 (double) is correct
3. Segments extend exactly from N/S/E/W cell edges to center in UV space

## Focus Areas

### 1. Sub-Pixel Anti-Aliased Elliptical Arc (HIGHEST PRIORITY)
- Replace `if (dist < threshold) hit = true` with a `smoothstep` blend
- The `color` output should interpolate between `bgColor` and `fgColor` based on sub-pixel coverage
- Ensure the stroke width exactly matches the straight segment's `thinH * 0.5 + epsilon`
- Verify the ellipse algebra: with center at corner (charW, charH) and semi-axes (cx, cy), the ellipse equation `(x-charW)²/cx² + (y-charH)²/cy² = 1` should yield points (cx, charH) and (charW, cy) — verify these are the exact cell edge midpoints

### 2. Font Size Change Stability
- Trace the full lifecycle: `NanoTermV2.destroy()` → `WebGLRenderer.destroy()` → `new NanoTermV2()` → `new WebGLRenderer()`
- Identify any leaked state, stale caches, or missing reinitialization
- Check if the GL context is properly lost/recreated or reused

### 3. Thickness Consistency
- Map the straight segment thickness model to match the arc thickness precisely
- Both should use the same `lineWidth` constant expressed in the same coordinate space (pixels or UV)

## Output Format

For each finding:
- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **File**: filename and line numbers
- **Category**: which focus area (1-3)
- **Description**: what the issue is
- **Suggested Fix**: concrete GLSL/JS code

End with: top 3 issues, overall assessment.
