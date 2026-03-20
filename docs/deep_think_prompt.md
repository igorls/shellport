# Architecture Review — NanoTermV2 WebGL/WebGPU Rendering Backend

## Project Context

**ShellPort** is a zero-dependency, browser-based terminal emulator library called **NanoTermV2**. It renders a full VT100/VT220/xterm-compatible terminal into an HTML `<canvas>` element using the Canvas2D API. The library is designed to be embedded in web applications to provide SSH/PTY access over WebSocket.

### Current Architecture

The entire renderer lives in `nanoterm.js` (~1800 lines). Key architectural elements:

- **Buffer Model**: Per-cell objects `{ char, fg, bg, flags }` stored in `Array<Array<Cell>>` — one array per row, one object per column. Primary and alternate screen buffers with scrollback.
- **Rendering Pipeline**: Two-pass Canvas2D rendering triggered via `requestAnimationFrame`:
  - Pass 1 (`renderRowBg`): Draws all background rectangles with run-length batching (coalesces consecutive cells with the same background color into single `fillRect` calls).
  - Pass 2 (`renderRowText`): Draws all text and decorations, also with attribute-run batching. Uses `fillText` for each character individually at precise cell coordinates to prevent subpixel drift.
- **Programmatic Unicode Rendering**: Block elements (U+2580–U+259F), box-drawing characters (U+2500–U+257F), and braille patterns (U+2800–U+28FF) are rendered programmatically using `fillRect` rather than font glyphs. This uses a detailed segment table for box-drawing with support for light, heavy, and double line weights.
- **Glyph Probing**: A pixel-comparison system that renders characters to a hidden canvas and compares against a known "tofu" signature (U+FFFF) to detect missing glyphs. Results are cached per codepoint. Private Use Area availability is batch-detected.
- **DPR Handling**: High-DPI support via `window.devicePixelRatio`, scaling the canvas backing store and using `setTransform` for logical-to-physical coordinate mapping.
- **Font Management**: Fractional `charWidth` for subpixel text placement, font caching via `lastFont` string comparison.

### Known Rendering Challenges (from recent audits)

1. **Subpixel seams**: Block characters need `+0.5px` overdraw to prevent visible gaps between adjacent cells
2. **Rounded corners**: Box-drawing characters at U+256D–U+2570 fall back to font rendering (curves can't be expressed as horizontal/vertical segments)
3. **SGR inversion**: Correct inverse color mapping for default fg/bg sentinel values (256/257)
4. **Per-character fillText**: Each glyph is drawn individually — no text run batching possible due to proportional-width prevention
5. **Full redraw on every frame**: No dirty-region tracking; the entire visible buffer is re-rendered every `requestAnimationFrame`

## Review Scope

**The Canvas2D renderer already works very well.** It produces correct, visually faithful output for the full VT100/VT220/xterm feature set including programmatic Unicode rendering. This is not a "fix what's broken" exercise.

Our ambition is to make NanoTermV2 **the most performant, yet lightweight, web terminal ever built** — maintaining the **zero-dependency philosophy** while pushing rendering to the hardware limit. We want to introduce a **WebGL2** (and optionally **WebGPU**) rendering backend that **coexists** with the proven Canvas2D fallback. The GPU path should achieve:

- **Pixel-perfect rendering**: Zero visual compromises — the GPU renderer must match or exceed Canvas2D fidelity for every glyph, decoration, and special character
- **Maximum throughput**: Handle `cat /dev/urandom | xxd` or scrolling 100K-line files at the GPU's vsync rate, not the CPU's text-shaping rate
- **Minimal weight**: No WebGL helper libraries, no third-party glyph rasterizers — the GPU renderer should be as self-contained as the Canvas2D renderer (~2000 lines or less)
- **Graceful coexistence**: Canvas2D remains the default fallback; GPU rendering is opt-in and degrades transparently

### Key Architectural Questions

1. **Renderer Abstraction Layer**: How should we design the interface between the terminal emulator (parser, buffer, state) and the renderer? What is the right abstraction boundary so Canvas2D, WebGL, and WebGPU renderers can be swapped at runtime or selected at initialization?

2. **Glyph Atlas Strategy**: WebGL/WebGPU terminal renderers typically pre-render glyphs into a texture atlas. How should we:
   - Build and manage the atlas (static vs dynamic/LRU)?
   - Handle the existing programmatic Unicode characters (block elements, box drawing, braille) — should these be atlas entries or shader-generated?
   - Handle glyph probing for PUA/Nerd Font symbols in the GPU context?
   - Deal with font changes and DPR changes (atlas invalidation)?

3. **Buffer-to-GPU Data Flow**: The current buffer uses per-cell JS objects. What is the optimal data structure for GPU upload?
   - Typed arrays? Packed attribute encoding?
   - How to minimize per-frame data transfer between CPU and GPU?
   - Dirty-region tracking to enable partial buffer updates?

4. **Feature Parity Concerns**: Which current features are trivial/hard/impossible to replicate in a GPU renderer?
   - Text decorations (underline, double underline, strikethrough, overline)
   - Selection highlighting with alpha blending
   - Cursor rendering with blink animation
   - Scrollback buffer scrolling
   - High-DPI / devicePixelRatio handling

5. **Fallback Strategy**: How should the system handle:
   - Browsers without WebGL2/WebGPU support?
   - WebGL context loss (and restoration)?
   - Mobile devices with limited GPU memory?

## Attached Context Packs

| File | Contents | Token Estimate |
|------|----------|----------------|
| `context_full.md` | Complete shellport source: nanoterm.js, app.js, server.ts, client.ts, crypto, types, tests, config | ~56K |

## Focus Areas

1. **Renderer Interface Design**: Propose a clean abstraction that separates terminal state from rendering. Consider:
   - What methods/data the renderer needs from the terminal (buffer access, cursor state, selection, scroll offset)
   - What events the terminal needs from the renderer (resize measurements, glyph metrics)
   - Whether the terminal buffer format itself should change to be GPU-friendly from the start

2. **WebGL Text Rendering Pipeline**: Design the glyph atlas and text rendering approach:
   - Atlas texture format and layout (monochrome vs RGBA, grid vs bin-packed)
   - Dynamic atlas growth strategy for uncommon glyphs
   - Subpixel positioning considerations (or lack thereof in a monospace grid)
   - How programmatic characters (blocks, box drawing) should be generated — atlas bake vs fragment shader

3. **GPU Buffer Management**: Design the CPU→GPU data transfer:
   - Packed cell representation (codepoint + fg + bg + flags in how many bytes per cell?)
   - Uniform buffer vs texture-based cell data
   - Instanced rendering vs full-screen quad approaches
   - Dirty-row tracking and partial upload strategies

4. **Shader Architecture**: Outline the vertex/fragment shader design:
   - Background and foreground in one pass or two?
   - How to handle text decorations (underline, strikethrough) — geometry vs fragment shader
   - Alpha blending for selection overlay
   - Cursor rendering approach

5. **WebGPU Future-Proofing**: Consider how the design supports a future WebGPU backend:
   - Compute shader opportunities (buffer diff, glyph rasterization)
   - Shared abstractions between WebGL and WebGPU
   - Whether to target WebGPU first and polyfill down to WebGL

6. **Performance Analysis**: Identify the actual bottlenecks in the current Canvas2D renderer and quantify the expected improvement from GPU rendering:
   - Where does the current renderer spend the most time? (fillRect? fillText? getImageData for glyph probing?)
   - What throughput improvement is realistic for terminal scrolling?
   - Are there intermediate optimizations (dirty tracking, offscreen canvas workers) worth doing before the GPU jump?

7. **Migration Path**: Propose a phased implementation plan:
   - What can be built first as a standalone proof-of-concept?
   - How to integrate incrementally without breaking the existing Canvas2D renderer?
   - Testing strategy for visual correctness comparison between renderers

## Output Format

For each focus area, provide:

- **Assessment**: Current state analysis and key considerations
- **Recommendation**: Concrete architectural recommendation with rationale
- **Code Sketch**: Where helpful, provide pseudocode or interface definitions
- **Risk**: What could go wrong and how to mitigate

End with:
- **Priority-ordered implementation roadmap** (what to build first, second, third)
- **Critical design decisions** that must be made before writing any code
- **Overall feasibility assessment** with estimated complexity per phase
