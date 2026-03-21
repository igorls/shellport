# Bug Hunt Review — ShellPort NanoTermV2 Mouse Protocol

## Project Context

ShellPort is a web-based terminal emulator using a custom NanoTermV2 engine. It renders terminal output via WebGL with a glyph atlas and procedural box-drawing. The terminal connects to a backend server over WebSocket, which spawns a real PTY (on Unix) or piped shell (on Windows). User keystrokes and mouse events are sent from the browser → WebSocket → PTY stdin.

Key files:
- `src/frontend/nanoterm/index.js` — Terminal core: VT parser, input handling, mouse tracking state machine, event handlers
- `src/frontend/nanoterm/webgl-renderer.js` — WebGL rendering engine
- `test/shellport-test-server.ts` — Test server that spawns PTY sessions
- `test/shellport-test.html` — Test harness UI

The terminal runs with `TERM=xterm-256color` and reports `TERM_PROGRAM=WezTerm`.

## Review Scope

**htop mouse clicks do not trigger column sorting or button presses**, despite the mouse protocol appearing to function correctly at the transport level. We need to identify why htop doesn't respond to click events.

### What Works
- htop enables mouse tracking: `?1000h` (normal tracking) and `?1006h` (SGR protocol) are correctly parsed and stored
- `onMouseDown` fires, `sendMouseReport` generates SGR sequences like `\x1b[<0;48;9M` (down) and `\x1b[<3;48;9m` (up)
- htop closes its help screen on mouse click — proving the SGR sequences reach the PTY and ncurses processes them
- Keyboard arrows work correctly after implementing DECCKM (`?1h`)
- Other TUI programs (vim, less) respond to arrows normally

### What Doesn't Work
- Clicking htop column headers (PID, USER, CPU%, MEM%) does NOT sort columns
- Clicking htop bottom function keys (F1, F2, etc.) does NOT activate them
- Clicking a process row does NOT highlight it
- The user reports that in Ghostty terminal, all of these mouse interactions work correctly with the same htop binary

### Debug Evidence
Console logs from the browser confirm:
```
[MOUSE] tracking=1000
[MOUSE] protocol=sgr
[MOUSE] mouseDown btn=0 tracking=1000 shift=false
[MOUSE] SGR report: type=down btn=0 mods=0 x=48 y=9 seq="\x1b[<0;48;9M"
[MOUSE] SGR report: type=up btn=3 mods=0 x=48 y=9 seq="\x1b[<3;48;9m"
```

## Attached Context Packs

| File             | Contents                                                | Token Estimate |
| ---------------- | ------------------------------------------------------- | -------------- |
| `context_full.md` | All JS/TS/HTML source files (index.js, webgl-renderer.js, test server, test HTML) | ~75K |

## Focus Areas

1. **SGR Mouse Protocol Compliance** — Compare our SGR mouse report format against the xterm specification. Specifically:
   - Is the button encoding correct for left-click down (`0`) and release (`3`)?
   - Is the SGR release format `\x1b[<3;x;ym` correct? Some implementations use `\x1b[<0;x;ym` for release. Check what ncurses/htop expects.
   - Should there be separate button tracking for the release event (preserving the original button number)?
   - Does htop/ncurses expect both `?1000h` AND `?1002h` for full interaction, or just `?1000h`?

2. **Coordinate System** — Verify the 1-based coordinate calculation:
   - The current formula: `Math.max(1, Math.floor((clientX - rect.left - pad) / charWidth) + 1)`
   - Is the padding subtraction correct? Compare what `getBoundingClientRect()` returns vs what the terminal padding does
   - Does the canvas have any CSS transform or scaling that could shift coordinates?

3. **DA (Device Attributes) and Terminal Identification** — Check if our DA response triggers different mouse behavior:
   - We respond to DA1 with `\x1b[>0;10;1c` — does ncurses interpret this as a terminal that doesn't support SGR mouse?
   - We respond to DA2 with `\x1b[?62;22c` — is this well-formed? Should it be `\x1b[>` instead of `\x1b[?`?
   - Check if `TERM_PROGRAM=WezTerm` causes ncurses to expect specific mouse behavior

4. **Event Timing and Sequencing** — Could there be a race condition?
   - Is the down+up pair sent too quickly (within the same event loop tick)?
   - Does the WebSocket batch them into a single frame?
   - Should we add a small delay between down and up?

5. **Mouse Mode State Machine** — Verify the setMode/resetMode handling:
   - When htop sends multiple mode sets (e.g., `?1000h` then `?1002h`), do they override correctly?
   - Is there any case where `mouseTracking` gets reset to 0 unexpectedly?
   - Check if the help screen close works because it uses a simpler "any key" handler vs column sorting needing proper coordinates

6. **Data Transport** — Check the WebSocket → PTY data path:
   - Client sends string via `TextEncoder.encode()` → binary WebSocket message
   - Server receives binary → `TextDecoder.decode()` → `terminal.write(string)`
   - Could the decode/encode round-trip corrupt the escape sequences?
   - Is `terminal.write()` (Bun's PTY API) equivalent to writing raw bytes to a file descriptor?

## Output Format

For each finding, provide:

- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **File**: path and line numbers
- **Category**: which focus area
- **Description**: what the bug is
- **Impact**: what happens in production
- **Suggested Fix**: concrete code changes with before/after

Group findings by severity. End with a summary: total counts, top 3 issues, overall assessment.
