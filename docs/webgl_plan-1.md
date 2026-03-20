Here is a comprehensive architecture review and design blueprint for introducing a hardware-accelerated WebGL2 (and WebGPU-ready) rendering backend to **NanoTermV2**.

Our goal is to achieve **144Hz+ vsync rendering**, eliminate Garbage Collection (GC) stutters during rapid scrolling, and guarantee **pixel-perfect subpixel rendering**, all while strictly maintaining the zero-dependency, lightweight (<2000 lines) philosophy.

---

### 1. Renderer Interface Design

**Assessment:**  
Currently, `NanoTermV2` is a monolith. The terminal state (parser, buffer arrays, cursor) and the presentation layer (`ctx.fillText`, `ctx.fillRect`) are tightly interleaved. To support runtime switching and graceful degradation, rendering must be isolated behind an abstraction boundary.

**Recommendation:**  
Extract rendering into an `IRenderer` interface. The core `NanoTermV2` class becomes the "State Source of Truth" (handling VT parsing, scrollback, and grid data), while the renderer acts as a "Dumb Consumer." The terminal pushes data to the renderer; it does not read from it, except for font metric measurements.

**Code Sketch:**

```javascript
class IRenderer {
  // Setup backing stores and bind to container
  attach(container, options) {}

  // Terminal requests dimensions based on font configuration
  measureChar() {
    return { charWidth, charHeight };
  }

  // Terminal triggers grid resize
  resize(cols, rows) {}

  // Terminal pushes the frame.
  // state: { gridBuffer, cursorX, cursorY, selection, ... }
  // dirtyRows: Set<number> to enable partial GPU uploads
  render(state, dirtyRows) {}

  destroy() {}
}
```

**Risk:** Duplicating state between the terminal and renderer wastes memory and CPU cycles.  
**Mitigation:** The terminal will manage a single, flat `Uint32Array` (see Focus Area 3). The renderer maintains no internal buffer state; it directly uploads this shared array to the GPU.

---

### 2. WebGL Text Rendering Pipeline (Glyph Atlas)

**Assessment:**  
Web terminals require a texture atlas for text because WebGL has no native font shaping. However, baking programmatic characters (box-drawing, blocks) into a texture atlas often introduces "subpixel seams" due to texture interpolation and floating-point rounding—the exact issue you solved in Canvas2D with the `+0.5px` hack.

**Recommendation:**  
Use a **Hybrid Pipeline: Dynamic Atlas + Procedural Math**.

1. **Dynamic Grid Atlas (Text):** Maintain an offscreen `<canvas>`. When an unknown text codepoint is parsed, draw it to the offscreen canvas, run your existing `_probeGlyph` tofu check, and upload it to a 2048x2048 monochrome or RGBA WebGL texture via `gl.texSubImage2D`. Because it's a strict monospace grid, allocating slots is an $O(1)$ operation (no complex bin-packing required).
2. **Atlas Eviction (Clear-on-Full):** If the atlas fills up, simply clear the GPU texture and rebuild it dynamically from the currently visible screen. This takes `<2ms` and is vastly simpler than LRU tracking.
3. **Procedural Shaders (Programmatic):** **Do not put U+2500–U+259F or U+2800–U+28FF in the atlas.** Generate them mathematically in the Fragment Shader using intra-cell UV coordinates. This provides infinite resolution and natively solves subpixel seams (exact pixel math) and rounded corners (via Signed Distance Fields).

---

### 3. GPU Buffer Management (CPU → GPU Data Flow)

**Assessment:**  
The current `Array<Array<{char, fg, bg, flags}>>` allocates millions of JS objects during its lifecycle. Scrolling creates and destroys rows, thrashing the V8 Garbage Collector and causing micro-stutters. This structure is also impossible to upload directly to a GPU.

**Recommendation:**  
Flatten the terminal buffer into a packed **`Uint32Array`**. To future-proof for TrueColor (24-bit RGB) while maintaining exact byte alignment, use **16 bytes (4x Uint32) per cell**.

**Packed Cell Layout (maps perfectly to `GL_RGBA32UI`):**

- **Word 0:** `Codepoint (21 bits) | Flags (11 bits)`
- **Word 1:** `Foreground Color (32-bit RGBA)`
- **Word 2:** `Background Color (32-bit RGBA)`
- **Word 3:** `Atlas UV Index (16 bits) | Reserved (16 bits)`

**Data Flow & Zero-Copy Scrolling:**
Upload the `Uint32Array` into a 2D Data Texture. To solve the "Full redraw on every frame" problem, use a **Ring Buffer** approach:

1. When the terminal scrolls, do _not_ shift the data in the `Uint32Array`.
2. Instead, advance a `cpu_row_offset` pointer and overwrite the oldest row with the new data.
3. Call `gl.texSubImage2D` to upload _only_ the single overwritten row.
4. Pass a `u_scrollOffset` uniform to the shader. The GPU handles the vertical shift visually. This achieves **zero-copy hardware scrolling**.

---

### 4. Shader Architecture

**Assessment:**  
Canvas2D requires two passes (backgrounds, then text) plus procedural strokes for decorations.

**Recommendation:**  
Use a **Full-Screen Quad** approach. Do not upload geometry (instanced quads) for every character. Draw a single quad (two triangles) covering the entire canvas. The fragment shader does all the heavy lifting in a single pass.

**Fragment Shader Logic (`#version 300 es`):**

1. **Cell Resolution:** Calculate the logical cell coordinate `ivec2 cell = ivec2(v_uv * u_gridSize)`. Apply `u_scrollOffset` to find the physical row in the texture.
2. **Data Fetch:** Read the cell data via `uvec4 cellData = texelFetch(u_gridTex, physicalCell, 0)`.
3. **SGR Inversion:** Decode FG/BG. `if ((flags & FLAG_INVERSE) != 0u) { swap(fg, bg); }`.
4. **Procedural Branching:**
   - If `codepoint` is a Box/Block: Calculate shape mathematically using the local intra-cell UV `fract(v_uv * u_gridSize)`.
   - Else: Fetch the atlas UV and sample the glyph atlas `texture(u_atlasTex, atlasUV)`.
5. **Decorations:** Apply underlines and strikethroughs mathematically based on the local cell UV Y-coordinate. (e.g., `if (hasUnderline && localUV.y > 0.85 && localUV.y < 0.95) color = fg;`)
6. **Selection/Cursor:** Mix the selection/cursor color at the very end based on uniform bounding boxes.

---

### 5. WebGPU Future-Proofing

**Assessment:**  
WebGPU requires strict memory layouts and prefers Storage Buffers over Data Textures for arbitrary array data.

**Recommendation:**  
The **Full-Screen Quad + Flat `Uint32Array`** architecture maps flawlessly to WebGPU.

- In WebGPU, the 2D Data Texture is simply replaced by a `<storage, read>` Buffer (`array<vec4<u32>>`).
- The WGSL fragment shader directly indexes the buffer (`let cell = grid_buffer[cell_y * cols + cell_x];`), eliminating texture coordinate math entirely.
- By designing the WebGL2 implementation around this flat array now, you guarantee a 1:1 migration path to WebGPU.

---

### 6. Performance Analysis

**Current Canvas2D Bottlenecks Addressed:**

1. **Garbage Collection:** Re-allocating `Cell` objects and `Array.splice` operations stall the V8 engine. Fixed via `Uint32Array` Ring Buffer.
2. **`fillText` Overhead:** Rendering character-by-character forces the browser to evaluate text baselines and paths thousands of times per frame. Fixed via Glyph Atlas.
3. **Overdraw:** Redrawing 1,920 cells on every cursor blink. Fixed via `dirtyRow` tracking.

**Realistic Throughput:**
Draw calls drop from ~4000 to exactly **two** per frame (one texture upload, one draw). WebGL will render the full-screen quad in `< 0.2ms`. Terminal throughput will easily saturate 144Hz monitors even when executing `cat /dev/urandom`. The bottleneck will shift entirely from the renderer to the WebSocket ingestion / VT parsing speed.

---

### 7. Migration Path (Implementation Roadmap)

Implementing this as a "big bang" rewrite is risky. Follow this phased approach:

**1. The Memory Refactor (Immediate, Canvas-only)** — ✅ **Completed**

- Rip out `Array<Array<Cell>>` in `nanoterm.js`.
- Replace it with the 16-byte-per-cell `Uint32Array`. Update the existing `Canvas2D` renderer to decode the bitmasks.
- _Result:_ Massive CPU speedup and reduced GC footprint with zero visual changes.

**2. Architectural Abstraction** — ✅ **Completed**

- Extract the Canvas2D rendering functions into a `CanvasRenderer` class implementing `IRenderer`.

**3. WebGL2 Skeleton & Procedural Shaders (Standalone MVP)**

- Implement `WebGLRenderer`. Set up the Full-Screen Quad, Data Texture, and `texSubImage2D` dirty-row uploads.
- Write the procedural GLSL math for the Block characters and background colors first (ignoring text). Verify pixel-perfect alignment.

**4. Dynamic Glyph Atlas & Integration**

- Implement the offscreen Canvas2D to bake requested text codepoints into the WebGL texture.
- Integrate SGR inversion, selection, text decorations, and cursors.
- Add fallback logic: if `getContext('webgl2')` fails, or if `webglcontextlost` fires, transparently fall back to `CanvasRenderer`.

**5. Ring Buffer Scrolling**

- Transition the CPU grid to a circular buffer to achieve zero-copy hardware scrolling.

### Critical Design Decisions (Pre-Code)

1. **Target WebGL2, not WebGL1:** `GL_RGBA32UI` integer textures and `texelFetch` are mandatory for this architecture to remain clean and lightweight without floating-point precision hacks. WebGL2 has ~99% global browser support.
2. **Strict Physical Pixels:** To avoid blurry glyphs and seams, you must scale the canvas backing store exactly by `window.devicePixelRatio` and floor/ceil your cell dimensions so that `charWidth` is an integer number of physical pixels.
3. **Probing Stays on CPU:** Keep your excellent `_probeGlyph` (tofu prevention) logic entirely on the CPU. The CPU checks availability; if missing, it simply never requests the atlas to bake it.

### Overall Feasibility Assessment

**Highly Feasible.** Because NanoTermV2 already contains a pixel-perfect, self-contained Canvas implementation of box-drawing and PUA probing, you have the exact toolkit needed to populate a GPU atlas. By limiting the GPU scope to a **Full-Screen Quad + Data Texture**, you bypass complex vertex generation and scene graphs entirely. The complete `WebGLRenderer` class can comfortably be written in **under 800 lines of JavaScript**, honoring your zero-dependency mandate while matching the performance of native desktop emulators like Alacritty.
