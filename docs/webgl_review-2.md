Here is the Round 2 stability and correctness review of NanoTermV2's rendering and interaction layers.

The core architecture—packing VT100 grid bits into an `RGBA32UI` texture to avoid floating-point bleeding—is phenomenal. It is exactly how best-in-class GPU terminal emulators operate. However, translating procedural geometry to a fragment shader has introduced a few mathematical edge cases, and the WebGL loop currently has some state-machine desyncs.

Here are the findings, grouped by severity, with concrete code fixes:

---

### 🔴 CRITICAL SEVERITY

#### 1. Rounded Corner Arc SDF Geometry Fails on Non-Square Cells

- **Category**: 1 (Rounded Corner Arc SDF)
- **File**: `webgl-renderer.js` (Lines 246–281, Fragment Shader)
- **Description**: There are two fundamental geometry flaws:
  1. **Inverted Quadrants:** `╭` (top-left of a box) connects the Right and Down midpoints, meaning it is drawn in the **bottom-right** quadrant of the cell. The current code restricts it to the top-left (`px.x <= halfW && px.y <= halfH`).
  2. **Circular Math:** A pure circle of `radius = min(halfW, halfH)` physically cannot pass through both the vertical and horizontal midpoints of a non-square cell. Standard terminal behavior maps an _elliptical arc_ centered perfectly at the cell center `(cx, cy)` with radii `(cx, cy)`.
- **Impact**: Rounded UI borders (like `tmux` or `lazygit` popups) will render as invisible or as floating, disconnected arcs.
- **Suggested Fix**: Use an algebraic distance approximation divided by the gradient magnitude to achieve a perfect 1-pixel thick elliptical arc:

```glsl
float cx = u_charSize.x * 0.5;
float cy = u_charSize.y * 0.5;
vec2 center;
bool inQuadrant = false;

if (codepoint == 0x256Du) { // ╭ Connects Right and Down
    center = vec2(u_charSize.x, u_charSize.y); // Center of the ellipse is the bottom-right corner
    inQuadrant = (px.x >= cx && px.y >= cy);   // Drawn in bottom-right cell quadrant
} else if (codepoint == 0x256Eu) { // ╮ Connects Left and Down
    center = vec2(0.0, u_charSize.y);
    inQuadrant = (px.x <= cx && px.y >= cy);
} else if (codepoint == 0x256Fu) { // ╯ Connects Left and Up
    center = vec2(0.0, 0.0);
    inQuadrant = (px.x <= cx && px.y <= cy);
} else if (codepoint == 0x2570u) { // ╰ Connects Right and Up
    center = vec2(u_charSize.x, 0.0);
    inQuadrant = (px.x >= cx && px.y <= cy);
}

if (inQuadrant) {
    vec2 d = px - center;
    // Ellipse algebraic equation: f = (x/a)^2 + (y/b)^2 - 1
    float f = (d.x*d.x)/(cx*cx) + (d.y*d.y)/(cy*cy) - 1.0;
    vec2 grad = vec2(2.0*d.x/(cx*cx), 2.0*d.y/(cy*cy));
    // Distance to edge is approx f / length(gradient). Keep thickness < 0.5px.
    float dist = abs(f) / length(grad);
    if (dist < 0.5) hit = true;
}
```

#### 2. Texture Double-Upload & 1-Frame Atlas Tearing

- **Category**: 3 & 4 (Texture Upload / Performance)
- **File**: `webgl-renderer.js` (Lines 521, 617)
- **Description**: `render()` uploads `gridData` via `gl.texSubImage2D`, _then_ calls `_updateAtlasForGrid()`, which computes indices and triggers a _second_ `gl.texSubImage2D` upload of the entire grid.
  Furthermore, if `_getAtlasIndex()` fills up the atlas mid-frame, `_rebuildAtlas()` wipes the texture clean. However, cells processed earlier in the loop keep their now-invalid indices, causing text to vanish for one frame.
- **Impact**: 2x PCIe bandwidth waste per frame, and violent graphical text flickering when the atlas fills up.
- **Suggested Fix**:
  1. Move the `_updateAtlasForGrid` call _before_ the WebGL texture upload in `render()`.
  2. Remove the `gl.texSubImage2D` block from the end of `_updateAtlasForGrid()`.
  3. Inside `_updateAtlasForGrid()`, restart the loop if a rebuild occurs:

```javascript
let rebuilds = 0;
let i = 0;
while (i < total) {
  // ... parse cp and flags ...
  const expectedSlot = this._atlasNextSlot;
  const atlasIdx = this._getAtlasIndex(cp, flags);

  // Atlas was wiped mid-frame! Restart loop to assign valid indices to earlier cells
  if (this._atlasNextSlot < expectedSlot) {
    rebuilds++;
    if (rebuilds > 1) {
      i++;
      continue;
    } // Failsafe
    i = 0;
    continue;
  }
  gridData[i * 4 + 3] = atlasIdx;
  i++;
}
```

#### 3. Selection Bugs: Scrollback Desync, Off-By-One, and Ctrl+C Trap

- **Category**: 6 (Clipboard & Input)
- **File**: `index.js` (Lines 720, 750, 799)
- **Description**: Three interlocking selection bugs completely break mouse usage:
  1. `getSelection()` explicitly reads from `this.grid`. If scrolled up, copying highlights the visual history but silently extracts the active buffer at the bottom of the screen.
  2. `onMouseDown` initializes `this.selection` as a 0-width object. Pressing `Ctrl+C` evaluates `if(this.selection)` to true, copies an empty string, and skips sending `\x03` to the shell.
  3. `endCol` is an exclusive boundary in `getSelection()`. Assigning `endCol: cell.x` in mouse events leaves the hovered character out of the copied text.
- **Suggested Fix**:
  - **In `getSelection()`**: Replicate the scrollback offset array extraction logic found in `_buildVisibleGrid()` instead of blindly querying `this.grid`.
  - **In `onMouseDown`**: Set `this.selection = null;` and let `onMouseMove` generate the object.
  - **In `onMouseMove`**: Append `+ 1` to `endCol`: `endCol: cell.x + 1`.

---

### 🟠 HIGH SEVERITY

#### 4. Double-Line Box Joints Leave Gaps and Protrusions

- **Category**: 2 (Box Drawing)
- **File**: `webgl-renderer.js` (Lines 148-188)
- **Description**: Horizontal segments strictly stop at exactly `cx + thinW * 0.5`. For double lines separated by `gapH` / `gapW`, stopping at the center means the outer parallel lines never touch (leaving a missing notch at corners like `╔`), and inner lines cross over to form a `#` shape inside the cell.
- **Impact**: Double-line layouts (e.g., Norton Commander style UIs) look jagged and broken.
- **Suggested Fix**: Replace the hardcoded `cx`/`cy` bounds with dynamic SDF-like bounds that check the max weight of orthogonal segments:

```glsl
// Add helper functions:
float ext_x(uint w) { return w == 3u ? gapW + thinW*0.5 : (w == 2u ? thickW*0.5 : (w == 1u ? thinW*0.5 : 0.0)); }
float ext_y(uint w) { return w == 3u ? gapH + thinH*0.5 : (w == 2u ? thickH*0.5 : (w == 1u ? thinH*0.5 : 0.0)); }

// Example for Left segment (lw):
if (lw == 3u) {
    // Top line extends outward to cover outer corners, or stops inward to prevent T-junction crossover
    float enTop = cx + (uw>0u && dw>0u ? -ext_x(uw) : (dw>0u ? ext_x(dw) : (uw>0u ? -ext_x(uw) : 0.0)));
    float enBot = cx + (uw>0u && dw>0u ? -ext_x(dw) : (uw>0u ? ext_x(uw) : (dw>0u ? -ext_x(dw) : 0.0)));
    if (localUV.x <= enTop && abs(localUV.y - (cy - gapH)) < thinH * 0.5) hit = true;
    if (localUV.x <= enBot && abs(localUV.y - (cy + gapH)) < thinH * 0.5) hit = true;
} else if (lw == 1u || lw == 2u) {
    float en = cx + (uw>0u && dw>0u ? 0.0 : (dw>0u ? ext_x(dw) : (uw>0u ? ext_x(uw) : 0.0)));
    float hW = lw == 2u ? thickH * 0.5 : thinH * 0.5;
    if (localUV.x <= en && abs(localUV.y - cy) < hW) hit = true;
}
// Repeat mirrored logic for rw, uw, dw.
```

#### 5. Per-Frame Garbage Allocation of Grid Data

- **Category**: 4 (Performance)
- **File**: `webgl-renderer.js` (Line 557)
- **Description**: `_buildVisibleGrid()` executes `new Uint32Array(cols * rows * 4)` completely from scratch every time a frame renders.
- **Impact**: Generates 30KB–150KB of garbage per frame, severely thrashing the V8 Garbage Collector during continuous scrolling outputs.
- **Suggested Fix**: Cache the array on the class instance.

```javascript
const size = cols * rows * 4;
if (!this._gridData || this._gridData.length !== size)
  this._gridData = new Uint32Array(size);
const gridData = this._gridData; // Repopulate inline
```

#### 6. High-DPI (Retina) Atlas Blurriness

- **Category**: 5 (Renderer Parity)
- **File**: `webgl-renderer.js` (`_getAtlasIndex`, `render`)
- **Description**: The canvas scales physically via `devicePixelRatio`, but the dynamic offscreen glyph atlas (`_atlasCanvas`) rasterizes text strictly in unscaled CSS pixels. Sampling a 1x texture on a 2x/3x Retina display forces WebGL to stretch the texture.
- **Suggested Fix**: Multiply `this.charWidth`, `this.charHeight`, and `this.options.fontSize` by `window.devicePixelRatio` specifically when interacting with the offscreen atlas canvas context and `_atlasSlotsPerRow`. Scale `u_atlasCellSize` in the shader to match.

---

### 🟡 MEDIUM SEVERITY

#### 7. Inverted Scroll Wheel Trackpad Rounding

- **Category**: 6 (Clipboard & Input)
- **File**: `index.js` (Line 817)
- **Description**: `Math.round(e.deltaY / this.charHeight)` immediately rounds smooth-scrolling trackpad events down to `0`. Furthermore, adding positive deltas to `scrollbackOffset` moves further away from history—the scrolling logic is backwards.
- **Suggested Fix**: Track fractional sub-row deltas in an accumulator, and subtract `delta` from `scrollbackOffset`.

### Final Assessment

The decision to utilize an `RGBA32UI` integer texture alongside an offscreen 2D canvas atlas fallback is robust. Once the distance-field math equations are patched to correctly accommodate gap intersections and non-square cell layouts, this module will be highly resilient. You are functionally three patches away from 60+ FPS sub-pixel perfection.
