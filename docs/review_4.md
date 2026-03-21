Here is the Bug Hunt Review for the ShellPort NanoTermV2 Mouse Protocol.

The underlying data transport pipeline (WebSocket binary to PTY) and the event sequence timings are highly robust. The reason `htop` closes its help screen but ignores column sorting/buttons traces back to semantic formatting errors within the terminal's SGR state machine, compounded by a JavaScript DOM event quirk.

Here are the concrete findings and fixes, grouped by severity:

---

### 🔴 CRITICAL SEVERITY

#### 1. SGR Protocol Release Event Sends Invalid Button ID (The `htop` Bug)

- **File**: `src/frontend/nanoterm/index.js` (Line 1045)
- **Category**: 1 (SGR Mouse Protocol Compliance)
- **Description**: In the legacy X10 protocol (`\x1b[M`), a mouse release is _always_ denoted by sending button ID `3`. However, the modern SGR 1006 protocol fixes this ambiguity by using a trailing `m` to indicate a release, and strictly requires the button ID to **exactly match the button that was pressed** (e.g., `0` for Left-Click). The current code unconditionally sets `if (type === 'up') button = 3;` for both protocols.
- **Impact**: `htop` receives `\x1b[<0;x;yM` (Left Press) followed by `\x1b[<3;x;ym` (Button 3 Release). Because the Left button (`0`) is never officially released, `htop` considers the mouse permanently held down. The click sequence never completes, and interactive UI elements are ignored. (The help screen closes only because it uses a simpler "on any input" trigger).
- **Suggested Fix**: Scope the `button = 3` override exclusively to the legacy mouse protocol.

```javascript
// Before
let button = e.button; // 0=left, 1=middle, 2=right
if (type === "up") button = 3;

// After
let button = overrideButton !== undefined ? overrideButton : e.button;
if (type === "up") {
  button = this.mouseProtocol === "sgr" ? button : 3;
}
```

#### 2. Read-Only Event Property Mutation Turns Scrolls into Clicks

- **File**: `src/frontend/nanoterm/index.js` (Line 1060)
- **Category**: 4 (Event Timing and Sequencing)
- **Description**: The `onWheel` method calculates the correct scroll button IDs (64 or 65) but attempts to pass them to the sender by mutating the event object: `e.button = button + 64;`. Under strict DOM specifications, `WheelEvent.button` is a read-only property, so this assignment silently fails. When `sendMouseReport` reads `e.button`, it defaults to `0` (Left Click).
- **Impact**: Attempting to scroll the mouse wheel inside `htop` or `vim` blasts the PTY with rapid left-clicks instead of scrolling.
- **Suggested Fix**: Pass the scroll button ID explicitly as an argument to `sendMouseReport`.

```javascript
// In index.js `onWheel` (Line ~1060):
const scrollButton = e.deltaY > 0 ? 65 : 64; // 65=down, 64=up
this.sendMouseReport(e, 'scroll', scrollButton);

// In index.js `sendMouseReport` signature (Line ~1033):
sendMouseReport(e, type, overrideButton) {
    // ...
```

---

### 🟠 HIGH SEVERITY

#### 3. Legacy Protocol UTF-8 Corruption & Modifier Loss

- **File**: `src/frontend/nanoterm/index.js` (Line 1052) & `src/frontend/app.js` (Line 135)
- **Category**: 6 (Data Transport) & 1 (Compliance)
- **Description**: The legacy X10 protocol fallback branch has two severe flaws:
  1. `button += 32; mods += 32;` calculates the modifier bits, but `mods` is never mathematically added to the button payload (`String.fromCharCode(button)`), totally stripping Shift/Ctrl/Alt states.
  2. Sending coordinates via `String.fromCharCode(x + 32)` will exceed ASCII bounds if the terminal is wider than 95 columns (`96 + 32 = 128`). Because `this.send(string)` in `app.js` routes through `TextEncoder.encode()`, values `> 127` are expanded into 2-byte UTF-8 sequences. The legacy PTY protocol expects exactly 3 bytes after `\x1b[M`, resulting in catastrophic sequence corruption.
- **Impact**: Shift-clicks fail to register. Clicking the right half of wide monitors completely breaks legacy mouse tracking.
- **Suggested Fix**: Apply the modifiers, and send raw binary `Uint8Array` bytes to bypass `TextEncoder`'s UTF-8 expansion.

```javascript
// In src/frontend/nanoterm/index.js
// Before
} else {
    button += 32; mods += 32;
    this.send(`\x1b[M${String.fromCharCode(button)}${String.fromCharCode(x + 32)}${String.fromCharCode(y + 32)}`);
}

// After
} else {
    const cb = button + mods + 32;
    // Send raw Uint8Array to prevent UTF-8 expansion
    this.send(new Uint8Array([0x1B, 0x5B, 0x4D, cb, Math.min(255, x + 32), Math.min(255, y + 32)]));
}
```

```javascript
// In src/frontend/app.js
// Before
const encoder = new TextEncoder();
sendMsg(0, encoder.encode(data));

// After
const payload =
  typeof data === "string" ? new TextEncoder().encode(data) : data;
sendMsg(0, payload);
```

---

### 🟡 MEDIUM SEVERITY

#### 4. Out-of-Bounds Clicks and Padding Miscalculations

- **File**: `src/frontend/nanoterm/index.js` (Lines 1035-1037)
- **Category**: 2 (Coordinate System)
- **Description**:
  1. The 1-based coordinates use `Math.max(1, ...)` to avoid negative bounds, but lack an upper clamping limit. Clicking exactly in the right/bottom padding evaluates to `this.cols + 1` or `this.rows + 1`.
  2. The default logic uses `this.options.padding || 6`. If a user deliberately configures zero padding (`0`), it falls back to `6`, skewing coordinate math by 6 pixels.
- **Impact**: TUIs that strictly validate grid bounds ignore clicks on the edges (like `htop`'s bottom F-key bar).
- **Suggested Fix**: Fix the logical OR and bound the upper limit using `Math.min()`.

```javascript
const pad = this.options.padding ?? 6;
const x = Math.max(
  1,
  Math.min(
    this.cols,
    Math.floor((e.clientX - rect.left - pad) / this.charWidth) + 1,
  ),
);
const y = Math.max(
  1,
  Math.min(
    this.rows,
    Math.floor((e.clientY - rect.top - pad) / this.charHeight) + 1,
  ),
);
```

#### 5. Mouse Wheel Tracking Blocked in Primary Buffer

- **File**: `src/frontend/nanoterm/index.js` (Line 1057)
- **Category**: 5 (Mouse Mode State Machine)
- **Description**: The `onWheel` handler enforces a strict requirement: it will only send mouse wheel reports to the backend if `this.useAlternate` is `true`. Several applications request `mouseTracking` but execute inside the Primary buffer (e.g., `fzf`, `mc`, or `less` depending on terminfo).
- **Impact**: You cannot scroll with the mouse wheel in primary-buffer TUIs.
- **Suggested Fix**: Prioritize `mouseTracking` independently of `useAlternate`.

```javascript
    onWheel(e) {
        if (this.mouseTracking) {
            e.preventDefault();
            const scrollButton = e.deltaY > 0 ? 65 : 64;
            this.sendMouseReport(e, 'scroll', scrollButton);
        } else if (!this.useAlternate) {
            e.preventDefault();
            // ... (existing smooth scroll history logic)
        }
    }
```

---

### Summary

- **Total Findings**: 5 (1 Critical, 2 High, 2 Medium)
- **Top 3 Issues**:
  1. The SGR 1006 protocol forcing `button = 3` on release, breaking click lifecycles.
  2. Mutating the read-only `WheelEvent.button` converting mouse wheel scrolling into left-click spam.
  3. `TextEncoder` expanding large X10 legacy coordinates into invalid multi-byte UTF-8 sequences.

**Overall Assessment**:
The parser logic, binary WebSocket bindings, and PTY bridging are highly resilient. Applying these five precise fixes to the DOM event mappings and SGR state machine will instantly unlock pixel-perfect interactivity for `htop`, `tmux`, and `vim`, aligning NanoTermV2's mouse behavior with modern desktop standards like xterm and WezTerm.
