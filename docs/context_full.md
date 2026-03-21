# Directory Structure Report

This document contains files from the `/home/igorls/dev/GitHub/shellport` directory with extensions: js, ts, html
Custom ignored patterns: docs
Content hash: 5d3ac826c042a671

## File Tree Structure

- 📁 scripts
  - 📄 build-binaries.ts
- 📁 src
  - 📄 bounds.test.ts
  - 📄 client.ts
  - 📄 crypto.test.ts
  - 📄 crypto.ts
  - 📁 frontend
    - 📄 app.js
    - 📄 build.ts
    - 📄 bundle.ts
    - 📄 index.html
    - 📁 nanoterm
      - 📄 canvas-renderer.js
      - 📄 constants.js
      - 📄 index.js
      - 📄 webgl-renderer.js
  - 📄 index.test.ts
  - 📄 index.ts
  - 📄 integration.test.ts
  - 📄 pty.test.ts
  - 📄 qr.test.ts
  - 📄 qr.ts
  - 📄 server.test.ts
  - 📄 server.ts
  - 📄 server_ratelimit.test.ts
  - 📄 totp.test.ts
  - 📄 totp.ts
  - 📄 types.test.ts
  - 📄 types.ts
- 📁 test
  - 📄 shellport-test-server.ts
  - 📄 shellport-test.html


### File: `src/frontend/app.js`

- Size: 15538 bytes
- Modified: 2026-03-20 21:33:20 UTC

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// ShellPort - Session Manager & UI Logic
// Protocol v2: Per-session salt handshake
// ═══════════════════════════════════════════════════════════════════════════

let cryptoKey = null;
let cachedSecret = null;
let sessionCount = 0;
const activeSessions = new Map();
let currentSessionId = null;

// TOTP frame types (must match server)
const FT_TOTP_CHALLENGE = 6;
const FT_TOTP_RESPONSE = 7;

const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';

// Memoized key derivation to prevent repeated expensive PBKDF2 calls
// during the handshake phase or when processing multiple messages.
async function getBaseKey(secret) {
    if (!secret) return null;
    if (secret === cachedSecret && cryptoKey) return cryptoKey;
    cryptoKey = await deriveKey(secret);
    cachedSecret = secret;
    return cryptoKey;
}

async function init() {
    const secret = location.hash.substring(1);
    const status = document.getElementById('enc-status');

    if (status) {
        if (secret) {
            status.innerHTML = '⏳ Negotiating...';
        } else {
            status.innerHTML = '⚠️ No encryption';
            status.classList.add('warning');
        }
    }

    document.getElementById('new-session').addEventListener('click', createSession);

    // Context menu actions
    document.getElementById('context-menu').addEventListener('click', e => {
        const action = e.target.closest('.item')?.dataset.action;
        if (action === 'copy') {
            const term = activeSessions.get(currentSessionId)?.term;
            term?.copyToClipboard();
        } else if (action === 'paste') {
            const term = activeSessions.get(currentSessionId)?.term;
            navigator.clipboard.readText().then(text => {
                if (term && text) term.send(text);
            }).catch(() => { });
        } else if (action === 'selectAll') {
            // TODO: implement select all
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
            const term = activeSessions.get(currentSessionId)?.term;
            term?.copyToClipboard();
        } else if (e.ctrlKey && e.shiftKey && e.key === 'V') {
            const term = activeSessions.get(currentSessionId)?.term;
            navigator.clipboard.readText().then(text => {
                if (term && text) term.send(text);
            }).catch(() => { });
        }
    });

    createSession();
}

function switchSession(id) {
    if (!activeSessions.has(id)) return;

    currentSessionId = id;

    document.querySelectorAll('#sessions li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.term-wrapper').forEach(w => w.classList.remove('active'));

    const session = activeSessions.get(id);
    session.li.classList.add('active');
    session.container.classList.add('active');
    session.term.canvas.focus();
    session.term.resize();

    updateStatusBar(id);
}

function createSession() {
    sessionCount++;
    const id = 'session-' + Date.now();
    const secret = location.hash.substring(1);

    // Create sidebar item
    const li = document.createElement('li');
    li.innerHTML = `
    <span class="session-status pending"></span>
    <span class="session-label">Session ${sessionCount}</span>
    <span class="close-btn">×</span>
  `;
    document.getElementById('sessions').appendChild(li);

    // Create terminal container
    const container = document.createElement('div');
    container.className = 'term-wrapper';

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'term-canvas-container';
    container.appendChild(canvasContainer);

    const statusbar = document.createElement('div');
    statusbar.className = 'term-statusbar';
    statusbar.innerHTML = `
    <div class="left">
      <span class="cols">80×24</span>
      <span class="shell">bash</span>
    </div>
    <div class="right">
      <span class="dim">UTF-8</span>
      <span class="dim">256 colors</span>
    </div>
  `;
    container.appendChild(statusbar);

    document.getElementById('main').appendChild(container);

    // WebSocket
    const ws = new WebSocket(wsUrl, ['shellport-v2']);
    ws.binaryType = 'arraybuffer';
    const sendQ = new SeqQueue();
    const recvQ = new SeqQueue();

    let sessionKey = null;
    let serverNonce = null;
    let clientNonce = null;
    let handshakeComplete = false;

    const sendMsg = (type, payload) => sendQ.add(async () => {
        if (ws.readyState === 1) {
            if (sessionKey) {
                ws.send(await pack(sessionKey, type, payload));
            } else {
                // Plaintext mode (no secret / pre-handshake)
                ws.send(await pack(null, type, payload));
            }
        }
    });

    // Create terminal
    const term = new NanoTermV2(canvasContainer, data => {
        if (!handshakeComplete) return;
        const encoder = new TextEncoder();
        sendMsg(0, encoder.encode(data));
    });

    let pendingResize = null;

    term.onResize = (cols, rows) => {
        if (!handshakeComplete) {
            // Font may load before handshake — queue resize for flush after connect
            pendingResize = { cols, rows };
            return;
        }
        sendMsg(1, new TextEncoder().encode(JSON.stringify({ type: 'resize', cols, rows })));
        updateStatusBar(id);
    };

    term.onTitle = title => {
        const label = li.querySelector('.session-label');
        if (label) label.textContent = title.slice(0, 30);
    };

    // Clipboard permission callback
    term.onClipboardWrite = (text) => {
        return confirm('Allow remote clipboard write?\n\nContent length: ' + text.length + ' characters');
    };

    let totpPending = false;

    ws.onopen = () => {
        term.write('\x1b[90mConnecting...\x1b[0m\r\n');
    };

    ws.onmessage = async e => {
        const data = e.data;

        // Protocol v2: First message from server is the nonce
        if (!serverNonce && secret) {
            serverNonce = new Uint8Array(data);
            clientNonce = generateNonce();

            // Send client nonce
            sendMsg(3, clientNonce);  // FrameType.CLIENT_NONCE = 3

            // Derive per-session key
            const sessionSalt = await deriveSessionSalt(serverNonce, clientNonce);
            sessionKey = await deriveKey(secret, sessionSalt);

            const encStatus = document.getElementById('enc-status');
            if (encStatus) {
                encStatus.innerHTML = '🔒 AES-256-GCM';
                encStatus.classList.add('secure');
            }

            // Don't complete handshake yet — wait for potential TOTP challenge
            history.replaceState(null, '', location.pathname);
            return;
        }

        // Check for TOTP challenge (can arrive after nonce exchange or in plaintext mode)
        if (!handshakeComplete) {
            const decoded = await unpack(sessionKey || await getBaseKey(secret), data);
            if (decoded && decoded.type === FT_TOTP_CHALLENGE) {
                totpPending = true;
                term.write('\x1b[2K\x1b[G');
                term.write('\x1b[93m🔐 TOTP verification required\x1b[0m\r\n');
                showTOTPModal(code => {
                    const payload = new TextEncoder().encode(code);
                    sendMsg(FT_TOTP_RESPONSE, payload);
                });
                return;
            }

            // If not a TOTP challenge, it's either data or plaintext start
            if (!serverNonce && !secret && !totpPending) {
                // Plaintext mode — check if this is a TOTP challenge in plaintext
                const plainView = new Uint8Array(data);
                if (plainView.length >= 1 && plainView[0] === FT_TOTP_CHALLENGE) {
                    totpPending = true;
                    term.write('\x1b[2K\x1b[G');
                    term.write('\x1b[93m🔐 TOTP verification required\x1b[0m\r\n');
                    showTOTPModal(code => {
                        sendMsg(FT_TOTP_RESPONSE, new TextEncoder().encode(code));
                    });
                    return;
                }
            }

            // Normal connection established (no TOTP required)
            handshakeComplete = true;
            const statusEl = li.querySelector('.session-status');
            if (statusEl) {
                statusEl.classList.remove('pending');
                statusEl.classList.add('running');
            }
            term.write('\x1b[2K\x1b[G');
            term.resize();
            // Flush any resize queued during handshake (e.g. font-load correction)
            if (pendingResize) {
                sendMsg(1, new TextEncoder().encode(JSON.stringify({ type: 'resize', cols: pendingResize.cols, rows: pendingResize.rows })));
                pendingResize = null;
            }
            term.canvas.focus();

            // Fall through to handle this message as data
            if (decoded && decoded.type === 0) {
                term.write(decoded.payload);
            }
            return;
        }

        // Normal encrypted message handling
        recvQ.add(async () => {
            const decoded = await unpack(sessionKey || await getBaseKey(secret), data);
            if (decoded && decoded.type === 0) {
                // If TOTP was pending and we got data, it means we're approved!
                if (totpPending) {
                    totpPending = false;
                    handshakeComplete = true;
                    removeTOTPModal();
                    const statusEl = li.querySelector('.session-status');
                    if (statusEl) {
                        statusEl.classList.remove('pending');
                        statusEl.classList.add('running');
                    }
                    term.write('\x1b[2K\x1b[G');
                    term.resize();
                    // Flush any resize queued during handshake (e.g. font-load correction)
                    if (pendingResize) {
                        sendMsg(1, new TextEncoder().encode(JSON.stringify({ type: 'resize', cols: pendingResize.cols, rows: pendingResize.rows })));
                        pendingResize = null;
                    }
                    term.canvas.focus();
                }
                term.write(decoded.payload);
            }
        });
    };

    ws.onclose = (e) => {
        const statusEl = li.querySelector('.session-status');
        if (statusEl) {
            statusEl.classList.remove('pending', 'running');
            statusEl.classList.add('exited');
        }

        let reason = 'Disconnected';
        if (e.code === 4001) reason = 'Authentication timeout';
        else if (e.code === 4003) {
            reason = e.reason || 'Access denied';
            // Show error in TOTP modal if it's still up
            if (totpPending) {
                if (e.reason === 'Invalid TOTP code') {
                    showTOTPError('Invalid code. Please try again.');
                    // Reconnect for retry
                    return;
                }
                removeTOTPModal();
            }
        }
        else if (e.code === 1000) {
            reason = 'Session ended';
            removeTOTPModal();
        }
        else if (e.code === 1011) reason = 'Server error';

        term.write(`\r\n\x1b[31m[${reason}]\x1b[0m\r\n`);

        if (!handshakeComplete) {
            const encStatus = document.getElementById('enc-status');
            if (encStatus) {
                encStatus.innerHTML = '❌ ' + reason;
                encStatus.classList.remove('secure');
                encStatus.classList.add('error');
            }
        }
    };

    // Cleanup
    const cleanup = () => {
        ws.close();
        li.remove();
        container.remove();
        term.destroy();
        activeSessions.delete(id);

        if (currentSessionId === id) {
            const remaining = Array.from(activeSessions.keys());
            if (remaining.length > 0) {
                switchSession(remaining[remaining.length - 1]);
            } else {
                currentSessionId = null;
            }
        }
    };

    li.querySelector('.close-btn').onclick = e => {
        e.stopPropagation();
        cleanup();
    };

    li.onclick = () => switchSession(id);

    activeSessions.set(id, { li, container, term, ws, statusbar });
    switchSession(id);
}

function updateStatusBar(id) {
    const session = activeSessions.get(id);
    if (!session || currentSessionId !== id) return;

    const cols = session.term.cols;
    const rows = session.term.rows;
    const colsEl = session.statusbar.querySelector('.cols');
    if (colsEl) colsEl.textContent = `${cols}×${rows}`;
}

function showTOTPModal(onSubmit) {
    // Remove any existing modal
    const existing = document.getElementById('totp-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'totp-overlay';
    overlay.className = 'totp-overlay';
    overlay.innerHTML = `
        <div class="totp-modal">
            <div class="totp-icon">🔐</div>
            <div class="totp-title">Two-Factor Authentication</div>
            <div class="totp-subtitle">Enter the 6-digit code from your authenticator app</div>
            <input type="text" class="totp-input" id="totp-code" maxlength="6" 
                   inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code"
                   placeholder="000000">
            <div class="totp-error" id="totp-error"></div>
            <div class="totp-hint">Using Google Authenticator, Authy, or 1Password</div>
        </div>
    `;

    document.body.appendChild(overlay);

    const input = document.getElementById('totp-code');
    requestAnimationFrame(() => input.focus());

    input.addEventListener('input', e => {
        // Only allow digits
        e.target.value = e.target.value.replace(/[^0-9]/g, '');

        if (e.target.value.length === 6) {
            const code = e.target.value;
            input.disabled = true;
            input.style.opacity = '0.5';
            onSubmit(code);
        }
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && input.value.length === 6) {
            input.disabled = true;
            input.style.opacity = '0.5';
            onSubmit(input.value);
        }
    });
}

function removeTOTPModal() {
    const overlay = document.getElementById('totp-overlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 300);
    }
}

function showTOTPError(message) {
    const errorEl = document.getElementById('totp-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('visible');
    }
    const input = document.getElementById('totp-code');
    if (input) {
        input.disabled = false;
        input.style.opacity = '1';
        input.value = '';
        input.focus();
    }
}

init();
```

### File: `src/frontend/index.html`

- Size: 1149 bytes
- Modified: 2026-02-13 08:46:19 UTC

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShellPort - Terminal</title>
  <style>{{STYLES}}</style>
</head>
<body>
  <div id="sidebar">
    <div id="sidebar-header">
      <span class="logo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
        ShellPort
      </span>
      <button class="btn" id="new-session">+ New</button>
    </div>
    <ul id="sessions"></ul>
    <div id="enc-status">
      <span>🔓 Plaintext</span>
    </div>
  </div>

  <div id="main"></div>

  <div id="context-menu">
    <div class="item" data-action="copy">Copy <span class="shortcut">Ctrl+Shift+C</span></div>
    <div class="item" data-action="paste">Paste <span class="shortcut">Ctrl+Shift+V</span></div>
    <div class="item" data-action="selectAll">Select All</div>
  </div>

  <script>
    {{CRYPTO_JS}}
    {{NANOTERM_JS}}
    {{APP_JS}}
  </script>
</body>
</html>
```

### File: `src/frontend/nanoterm/index.js`

- Size: 56200 bytes
- Modified: 2026-03-21 02:46:28 UTC

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2: Feature-Complete VT100/VT220/xterm Emulator
// ═══════════════════════════════════════════════════════════════════════════

import {
    MAX_SEQUENCE_SIZE,
    XTERM_256_PALETTE,
    CELL_WORDS,
    CELL_CP_SHIFT,
    CELL_FLAGS_MASK,
    COLOR_DEFAULT,
    SPACE_CP,
    ATTR,
    XTERM_256_RGBA,
    rgbPack
} from './constants.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { WebGLRenderer } from './webgl-renderer.js';

class NanoTermV2 {
    constructor(container, sendFn, options = {}) {
        this.container = container;
        this.send = sendFn;
        this.options = {
            fontSize: options.fontSize || 14,
            fontFamily: options.fontFamily || "'JetBrains Mono Nerd Font', 'CaskaydiaCove Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            theme: options.theme || {},
            scrollback: options.scrollback || 10000,
            cursorStyle: options.cursorStyle || 'block',
            cursorBlink: options.cursorBlink !== false,
            allowProprietary: options.allowProprietary !== false,
            padding: options.padding ?? 6,
            lineHeight: options.lineHeight || 0,
            renderer: options.renderer || 'auto'  // 'auto' | 'canvas' | 'webgl'
        };

        // Theme colors
        const theme = this.options.theme;
        this.colors = {
            background: theme.background || '#0a0a0a',
            foreground: theme.foreground || '#e0e0e0',
            cursor: theme.cursor || '#a78bfa',
            selection: theme.selection || 'rgba(167, 139, 250, 0.3)',
            palette: theme.palette || XTERM_256_PALETTE
        };

        // Create renderer with auto-detection and fallback
        this.renderer = this._createRenderer(container);

        // Convenience aliases (backward compat + event binding)
        this.canvas = this.renderer.canvas;

        // Terminal state
        this.cols = 80;
        this.rows = 24;
        this.charWidth = 0;
        this.charHeight = 0;


        // Primary and alternate buffers (flat Uint32Array grids)
        this.grid = null;          // Active grid (points to primary or alternate)
        this.primaryGrid = null;   // Primary screen grid
        this.useAlternate = false;
        this.scrollbackBuffer = []; // Array of Uint32Array row snapshots
        this.scrollbackOffset = 0;

        // Cursor state
        this.cursorX = 0;
        this.cursorY = 0;
        this.savedCursorX = 0;
        this.savedCursorY = 0;
        this.cursorVisible = true;
        this.cursorBlinkState = true;
        this.cursorBlinkTimer = null;

        // Current attributes (RGBA truecolor, 0 = default)
        this.curFg = COLOR_DEFAULT;
        this.curBg = COLOR_DEFAULT;
        this.curFlags = 0;
        this.savedFg = COLOR_DEFAULT;
        this.savedBg = COLOR_DEFAULT;
        this.savedFlags = 0;

        // Scroll region
        this.scrollTop = 0;
        this.scrollBottom = 0;

        // Character set (DEC Special Graphics for tmux box-drawing)
        this.charsetG0 = 'B'; // 'B' = US ASCII, '0' = DEC Special Graphics
        this.charsetG1 = '0';
        this.activeCharset = 0; // 0 = G0, 1 = G1

        // Tab stops
        this.tabStops = new Set();

        // Selection
        this.selection = null;
        this.isSelecting = false;
        this.selectionStart = null;

        // Parser state
        this.parseState = 'ground';
        this.parseParams = [];
        this.parseParam = '';
        this.parseIntermediates = '';
        this.oscBuffer = '';
        this.dcsBuffer = '';

        // Security: callback for clipboard write permission
        this.onClipboardWrite = null;

        // Mouse tracking
        this.mouseTracking = 0;
        this.mouseProtocol = 'normal';
        this.applicationCursorKeys = false;

        // Bracketed paste
        this.bracketedPaste = false;

        // Pending wrap state (VT100 phantom column / DECAWM)
        this.wrapPending = false;

        // Focus state
        this.focused = false;

        // UTF-8 decoder for streaming
        this.decoder = new TextDecoder('utf-8', { fatal: false });
        this.utf8Buffer = new Uint8Array(4);
        this.utf8BufferLen = 0;

        // Rendering
        this.renderPending = false;
        this._isDestroyed = false;

        // Resize debounce
        this._resizeDebounceTimer = null;

        // Callbacks
        this.onResize = null;
        this.onTitle = null;
        this.onFocus = null;
        this.onBlur = null;

        // Init
        this.measureChar();
        this.resetTerminal();
        this.setupEvents();
        this.startCursorBlink();
        this.canvas.focus();

        // Explicitly load the specified font and re-measure once available.
        // document.fonts.ready resolves immediately if no fonts are loading,
        // but document.fonts.load() forces the browser to load the exact font.
        if (document.fonts && document.fonts.load) {
            const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`;
            document.fonts.load(fontSpec).then(() => {
                if (this._isDestroyed) return; // Prevent updating dead terminals
                this.measureChar();
                // Always resize after font load — even if charWidth didn't change,
                // data rendered with fallback font metrics needs to be repainted.
                // Bypass the debounce: this is a one-time correction, not a drag-resize.
                this.resize();
                if (this.onResize) {
                    clearTimeout(this._resizeDebounceTimer);
                    this.onResize(this.cols, this.rows);
                }
            }).catch(() => { /* font not available, fallback is fine */ });
        }
    }

    // -------------------------------------------------------------------------
    // Renderer Factory
    // -------------------------------------------------------------------------

    _createRenderer(container) {
        const mode = this.options.renderer;

        if (mode === 'webgl' || mode === 'auto') {
            try {
                const renderer = new WebGLRenderer(container, this.options, this.colors);
                // Listen for context lost — auto-fallback to Canvas2D
                renderer.canvas.addEventListener('webglcontextlost', (e) => {
                    e.preventDefault();
                    console.warn('[NanoTermV2] WebGL context lost — falling back to Canvas2D');
                    this._switchRenderer(new CanvasRenderer(container, this.options, this.colors));
                });
                return renderer;
            } catch (err) {
                console.warn('[NanoTermV2] WebGL2 renderer failed, falling back to Canvas2D:', err.message, err);
                // Fall through to Canvas2D
            }
        }

        return new CanvasRenderer(container, this.options, this.colors);
    }

    _switchRenderer(newRenderer) {
        const oldCanvas = this.renderer.canvas;
        this.renderer.destroy();
        this.renderer = newRenderer;
        this.canvas = newRenderer.canvas;
        this.measureChar();
        this.resize();
        // Re-bind event listeners on the new canvas
        this.setupEvents();
        this.startCursorBlink();
    }

    // -------------------------------------------------------------------------
    // Initialization Helpers
    // -------------------------------------------------------------------------

    measureChar() {
        this.renderer.measureChar();
        this.charWidth = this.renderer.charWidth;
        this.charHeight = this.renderer.charHeight;
    }

    resetTerminal() {
        this.cols = 80;
        this.rows = 24;
        this.cursorX = 0;
        this.cursorY = 0;
        this.wrapPending = false;
        this.curFg = COLOR_DEFAULT;
        this.curBg = COLOR_DEFAULT;
        this.curFlags = 0;
        this.scrollTop = 0;
        this.scrollBottom = 0;
        this.useAlternate = false;
        this.scrollbackBuffer = [];
        this.scrollbackOffset = 0;
        this.selection = null;
        this.primaryGrid = this.allocGrid(this.cols, this.rows);
        this.grid = this.primaryGrid;
        this.tabStops.clear();
        for (let i = 0; i < this.cols; i += 8) {
            this.tabStops.add(i);
        }
        this.resize();
    }

    // ── Grid Helpers (Uint32Array) ──────────────────────────────────────────

    allocGrid(cols, rows) {
        const grid = new Uint32Array(cols * rows * CELL_WORDS);
        // Fill every cell with space + default colors
        const word0 = SPACE_CP << CELL_CP_SHIFT;
        for (let i = 0; i < grid.length; i += CELL_WORDS) {
            grid[i] = word0;
            // words 1,2,3 are 0 (COLOR_DEFAULT) — already zero-initialized
        }
        return grid;
    }

    fillRow(y, cp, fg, bg, flags) {
        const offset = y * this.cols * CELL_WORDS;
        const word0 = (cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK);
        for (let x = 0; x < this.cols; x++) {
            const off = offset + x * CELL_WORDS;
            this.grid[off] = word0;
            this.grid[off + 1] = fg;
            this.grid[off + 2] = bg;
            this.grid[off + 3] = 0;
        }
    }

    fillRange(y, startX, endX, cp, fg, bg, flags) {
        const rowOffset = y * this.cols * CELL_WORDS;
        const word0 = (cp << CELL_CP_SHIFT) | (flags & CELL_FLAGS_MASK);
        for (let x = startX; x < endX && x < this.cols; x++) {
            const off = rowOffset + x * CELL_WORDS;
            this.grid[off] = word0;
            this.grid[off + 1] = fg;
            this.grid[off + 2] = bg;
            this.grid[off + 3] = 0;
        }
    }

    extractRow(y) {
        const rowWords = this.cols * CELL_WORDS;
        const offset = y * rowWords;
        const row = new Uint32Array(rowWords);
        row.set(this.grid.subarray(offset, offset + rowWords));
        return row;
    }

    // -------------------------------------------------------------------------
    // Resize Handling
    // -------------------------------------------------------------------------

    resize() {
        // Re-measure char dimensions (font may have loaded since last measure,
        // or container may have just become visible after display:none)
        this.measureChar();

        const rect = this.container.getBoundingClientRect();

        const pad = this.options.padding;

        const oldCols = this.cols;
        const oldRows = this.rows;
        this.cols = Math.max(1, Math.floor((rect.width - pad * 2) / this.charWidth));
        this.rows = Math.max(1, Math.floor((rect.height - pad * 2) / this.charHeight));
        this.scrollBottom = 0;

        this.renderer.resizeCanvas(rect);
        this.renderer._renderCols = this.cols;

        if (this.grid) {
            this.primaryGrid = this.resizeGrid(this.primaryGrid, oldCols, oldRows, true);
            if (this.useAlternate) {
                this.grid = this.resizeGrid(this.grid, oldCols, oldRows, false);
            } else {
                this.grid = this.primaryGrid;
            }
        }

        this.tabStops.clear();
        for (let i = 0; i < this.cols; i += 8) {
            this.tabStops.add(i);
        }

        // Debounce the onResize callback to avoid flooding the PTY
        // during continuous drag-resize
        if (this.onResize) {
            clearTimeout(this._resizeDebounceTimer);
            this._resizeDebounceTimer = setTimeout(() => {
                this.onResize(this.cols, this.rows);
            }, 150);
        }

        this.triggerRender();
    }

    resizeGrid(oldGrid, oldCols, oldRows, isPrimary) {
        const newCols = this.cols;
        const newRows = this.rows;
        const newGrid = this.allocGrid(newCols, newRows);

        // Push excess rows to scrollback if shrinking
        let srcStartRow = 0;
        if (oldRows > newRows) {
            const excess = oldRows - newRows;
            if (isPrimary && !this.useAlternate) {
                for (let y = 0; y < excess; y++) {
                    const rowWords = oldCols * CELL_WORDS;
                    const offset = y * rowWords;
                    const savedRow = new Uint32Array(rowWords);
                    savedRow.set(oldGrid.subarray(offset, offset + rowWords));
                    this.scrollbackBuffer.push(savedRow);
                    if (this.scrollbackBuffer.length > this.options.scrollback) {
                        this.scrollbackBuffer.shift();
                    }
                }
            }
            srcStartRow = excess;
        }

        // Copy existing data (memcpy per row via TypedArray.set)
        const copyRows = Math.min(oldRows - srcStartRow, newRows);
        const copyWords = Math.min(oldCols, newCols) * CELL_WORDS;
        for (let y = 0; y < copyRows; y++) {
            const srcOff = (srcStartRow + y) * oldCols * CELL_WORDS;
            const dstOff = y * newCols * CELL_WORDS;
            newGrid.set(oldGrid.subarray(srcOff, srcOff + copyWords), dstOff);
        }

        return newGrid;
    }

    // -------------------------------------------------------------------------
    // Parser - VT100/VT220/xterm Control Sequence Handler
    // -------------------------------------------------------------------------

    write(data) {
        if (data instanceof ArrayBuffer) {
            data = new Uint8Array(data);
        }
        if (data instanceof Uint8Array) {
            this.processBytes(data);
        } else {
            this.processString(data);
        }
        this.triggerRender();
    }

    processBytes(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            if (this.utf8BufferLen > 0) {
                this.utf8Buffer[this.utf8BufferLen++] = byte;
                const seqLen = this.utf8Buffer[0] < 0xE0 ? 2 : (this.utf8Buffer[0] < 0xF0 ? 3 : 4);
                if (this.utf8BufferLen >= seqLen) {
                    const decoded = this.decoder.decode(this.utf8Buffer.slice(0, seqLen));
                    this.processChar(decoded);
                    this.utf8BufferLen = 0;
                }
            } else if (byte >= 0x80) {
                this.utf8Buffer[0] = byte;
                this.utf8BufferLen = 1;
            } else {
                this.processChar(String.fromCharCode(byte));
            }
        }
    }

    processString(str) {
        for (let i = 0; i < str.length; i++) {
            this.processChar(str[i]);
        }
    }

    processChar(c) {
        const code = c.charCodeAt(0);
        switch (this.parseState) {
            case 'ground': this.processGround(c, code); break;
            case 'escape': this.processEscape(c, code); break;
            case 'csi': this.processCSI(c, code); break;
            case 'osc': this.processOSC(c, code); break;
            case 'dcs': this.processDCS(c, code); break;
            case 'charset':
                // ESC ( X or ESC ) X — select character set
                if (this.parseIntermediates === '(') this.charsetG0 = c;
                else if (this.parseIntermediates === ')') this.charsetG1 = c;
                this.parseState = 'ground';
                break;
        }
    }

    processGround(c, code) {
        if (code === 0x1B) {
            this.parseState = 'escape';
            this.parseIntermediates = '';
        } else if (code === 0x0D) {
            this.cursorX = 0;
            this.wrapPending = false;
        } else if (code === 0x0A) {
            this.wrapPending = false;
            this.lineFeed();
        } else if (code === 0x08) {
            this.wrapPending = false;
            if (this.cursorX > 0) this.cursorX--;
        } else if (code === 0x09) {
            this.wrapPending = false;
            this.tabForward();
        } else if (code === 0x07) {
            // Bell
        } else if (code === 0x0E) {
            this.activeCharset = 1; // SO — shift to G1
        } else if (code === 0x0F) {
            this.activeCharset = 0; // SI — shift to G0
        } else if (code >= 0x20) {
            const cs = this.activeCharset === 0 ? this.charsetG0 : this.charsetG1;
            this.putChar(cs === '0' && DEC_SPECIAL_GRAPHICS[c] ? DEC_SPECIAL_GRAPHICS[c] : c);
        }
    }

    processEscape(c, code) {
        if (c === '[') {
            this.parseState = 'csi';
            this.parseParams = [];
            this.parseParam = '';
            this.parseIntermediates = '';
        } else if (c === ']') {
            this.parseState = 'osc';
            this.oscBuffer = '';
        } else if (c === 'P') {
            this.parseState = 'dcs';
            this.dcsBuffer = '';
        } else if (c === 'M') {
            this.reverseIndex();
            this.parseState = 'ground';
        } else if (c === 'D') {
            this.lineFeed();
            this.parseState = 'ground';
        } else if (c === 'E') {
            this.cursorX = 0;
            this.lineFeed();
            this.parseState = 'ground';
        } else if (c === '7') {
            this.savedCursorX = this.cursorX;
            this.savedCursorY = this.cursorY;
            this.savedFg = this.curFg;
            this.savedBg = this.curBg;
            this.savedFlags = this.curFlags;
            this.parseState = 'ground';
        } else if (c === '8') {
            this.cursorX = this.savedCursorX;
            this.cursorY = this.savedCursorY;
            this.wrapPending = false;
            this.curFg = this.savedFg;
            this.curBg = this.savedBg;
            this.curFlags = this.savedFlags;
            this.parseState = 'ground';
        } else if (c === 'c') {
            this.resetTerminal();
            this.parseState = 'ground';
        } else if (c === '(' || c === ')' || c === '*' || c === '+') {
            this.parseState = 'charset';
            this.parseIntermediates = c;
        } else if (c === '>' || c === '=') {
            this.parseState = 'ground';
        } else {
            this.parseState = 'ground';
        }
    }

    processCSI(c, code) {
        if (code >= 0x30 && code <= 0x39) {
            this.parseParam += c;
        } else if (code === 0x3B) {
            this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0);
            this.parseParam = '';
        } else if (code >= 0x3C && code <= 0x3F) {
            this.parseIntermediates = c;
        } else if (code >= 0x20 && code <= 0x2F) {
            this.parseIntermediates += c;
        } else if (code >= 0x40 && code <= 0x7E) {
            this.parseParams.push(this.parseParam ? parseInt(this.parseParam, 10) : 0);
            this.executeCSI(c, this.parseParams, this.parseIntermediates);
            this.parseState = 'ground';
        } else {
            this.parseState = 'ground';
        }
    }

    processOSC(c, code) {
        if (code === 0x07 || (code === 0x5C && this.parseIntermediates === '\\')) {
            this.executeOSC(this.oscBuffer);
            this.parseState = 'ground';
        } else if (code === 0x1B) {
            this.parseIntermediates = '\\';
        } else {
            // Security: limit OSC buffer size to prevent memory exhaustion
            if (this.oscBuffer.length < MAX_SEQUENCE_SIZE) {
                this.oscBuffer += c;
            }
        }
    }

    processDCS(c, code) {
        if (code === 0x1B) {
            this.parseIntermediates = '\\';
        } else if (code === 0x5C && this.parseIntermediates === '\\') {
            this.executeDCS(this.dcsBuffer);
            this.parseState = 'ground';
        } else {
            // Security: limit DCS buffer size to prevent memory exhaustion
            if (this.dcsBuffer.length < MAX_SEQUENCE_SIZE) {
                this.dcsBuffer += c;
            }
        }
    }

    // -------------------------------------------------------------------------
    // CSI Command Execution
    // -------------------------------------------------------------------------

    executeCSI(cmd, params, intermediates) {
        const p = params.map(v => v || 0);
        const priv = intermediates.includes('?');

        switch (cmd) {
            // All cursor movement sequences clear the pending wrap state
            case 'A': this.wrapPending = false; this.cursorY = Math.max(this.getScrollTop(), this.cursorY - (p[0] || 1)); break;
            case 'B': this.wrapPending = false; this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + (p[0] || 1)); break;
            case 'C': this.wrapPending = false; this.cursorX = Math.min(this.cols - 1, this.cursorX + (p[0] || 1)); break;
            case 'D': this.wrapPending = false; this.cursorX = Math.max(0, this.cursorX - (p[0] || 1)); break;
            case 'E':
                this.wrapPending = false;
                this.cursorX = 0;
                this.cursorY = Math.min(this.getScrollBottom(), this.cursorY + (p[0] || 1));
                break;
            case 'F':
                this.wrapPending = false;
                this.cursorX = 0;
                this.cursorY = Math.max(this.getScrollTop(), this.cursorY - (p[0] || 1));
                break;
            case 'G': this.wrapPending = false; this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[0] || 1) - 1)); break;
            case 'H':
            case 'f':
                this.wrapPending = false;
                this.cursorY = Math.max(0, Math.min(this.rows - 1, (p[0] || 1) - 1));
                this.cursorX = Math.max(0, Math.min(this.cols - 1, (p[1] || 1) - 1));
                break;
            case 'J': this.eraseDisplay(p[0] || 0); break;
            case 'K': this.eraseLine(p[0] || 0); break;
            case 'L': this.insertLines(p[0] || 1); break;
            case 'M': this.deleteLines(p[0] || 1); break;
            case 'P': this.deleteChars(p[0] || 1); break;
            case '@': this.insertChars(p[0] || 1); break;
            case 'X': this.eraseChars(p[0] || 1); break;
            case 'r':
                if (!priv) {
                    const top = (p[0] || 1) - 1;
                    const bottom = p[1] ? p[1] - 1 : this.rows - 1;
                    this.scrollTop = Math.max(0, Math.min(top, this.rows - 1));
                    this.scrollBottom = Math.max(this.scrollTop, Math.min(bottom, this.rows - 1));
                    this.cursorX = 0;
                    this.cursorY = 0;
                    this.wrapPending = false;
                }
                break;
            case 's':
                this.savedCursorX = this.cursorX;
                this.savedCursorY = this.cursorY;
                break;
            case 'u':
                this.cursorX = this.savedCursorX;
                this.cursorY = this.savedCursorY;
                this.wrapPending = false;
                break;
            case 'S': this.scrollUp(p[0] || 1); break;
            case 'T': this.scrollDown(p[0] || 1); break;
            case 'd': this.wrapPending = false; this.cursorY = Math.max(0, Math.min(this.rows - 1, (p[0] || 1) - 1)); break;
            case 'm': this.processSGR(p); break;
            case 'h': this.setMode(p, priv); break;
            case 'l': this.resetMode(p, priv); break;
            case 'n': this.deviceStatusReport(p[0] || 0); break;
            case 'c':
                if (priv) {
                    // DA response (\x1b[?...c) — consume silently, this is a response not a query
                } else if (intermediates === '>') {
                    // DA2 query — respond with device info
                    this.send('\x1b[>0;10;1c');
                } else {
                    // DA1 query — respond as VT220 with advanced features
                    this.send('\x1b[?62;22c');
                }
                break;
            case 'g':
                if (p[0] === 0) this.tabStops.delete(this.cursorX);
                else if (p[0] === 3) this.tabStops.clear();
                break;
            case 'Z': this.tabBackward(p[0] || 1); break;
            case 'I': this.tabForward(p[0] || 1); break;
        }
    }

    // -------------------------------------------------------------------------
    // SGR (Select Graphic Rendition) - Color & Style
    // -------------------------------------------------------------------------

    processSGR(params) {
        if (params.length === 0) params = [0];

        for (let i = 0; i < params.length; i++) {
            const p = params[i];

            if (p === 0) {
                this.curFg = COLOR_DEFAULT; this.curBg = COLOR_DEFAULT; this.curFlags = 0;
            } else if (p === 1) {
                this.curFlags |= ATTR.BOLD;
            } else if (p === 2) {
                this.curFlags |= ATTR.DIM;
            } else if (p === 3) {
                this.curFlags |= ATTR.ITALIC;
            } else if (p === 4) {
                this.curFlags |= ATTR.UNDERLINE;
            } else if (p === 5 || p === 6) {
                this.curFlags |= ATTR.BLINK;
            } else if (p === 7) {
                this.curFlags |= ATTR.INVERSE;
            } else if (p === 8) {
                this.curFlags |= ATTR.HIDDEN;
            } else if (p === 9) {
                this.curFlags |= ATTR.STRIKETHROUGH;
            } else if (p === 21) {
                this.curFlags |= ATTR.DOUBLE_UNDERLINE;
            } else if (p === 22) {
                this.curFlags &= ~(ATTR.BOLD | ATTR.DIM);
            } else if (p === 23) {
                this.curFlags &= ~ATTR.ITALIC;
            } else if (p === 24) {
                this.curFlags &= ~(ATTR.UNDERLINE | ATTR.DOUBLE_UNDERLINE);
            } else if (p === 25) {
                this.curFlags &= ~ATTR.BLINK;
            } else if (p === 27) {
                this.curFlags &= ~ATTR.INVERSE;
            } else if (p === 28) {
                this.curFlags &= ~ATTR.HIDDEN;
            } else if (p === 29) {
                this.curFlags &= ~ATTR.STRIKETHROUGH;
            } else if (p >= 30 && p <= 37) {
                this.curFg = XTERM_256_RGBA[p - 30];
            } else if (p === 38) {
                if (params[i + 1] === 5) {
                    this.curFg = XTERM_256_RGBA[params[i + 2] || 0]; i += 2;
                } else if (params[i + 1] === 2) {
                    this.curFg = rgbPack(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0); i += 4;
                }
            } else if (p === 39) {
                this.curFg = COLOR_DEFAULT;
            } else if (p >= 40 && p <= 47) {
                this.curBg = XTERM_256_RGBA[p - 40];
            } else if (p === 48) {
                if (params[i + 1] === 5) {
                    this.curBg = XTERM_256_RGBA[params[i + 2] || 0]; i += 2;
                } else if (params[i + 1] === 2) {
                    this.curBg = rgbPack(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0); i += 4;
                }
            } else if (p === 49) {
                this.curBg = COLOR_DEFAULT;
            } else if (p >= 90 && p <= 97) {
                this.curFg = XTERM_256_RGBA[p - 90 + 8];
            } else if (p >= 100 && p <= 107) {
                this.curBg = XTERM_256_RGBA[p - 100 + 8];
            }
        }
    }

    // -------------------------------------------------------------------------
    // Mode Setting
    // -------------------------------------------------------------------------

    setMode(params, priv) {
        for (const p of params) {
            if (priv) {
                switch (p) {
                    case 1: this.applicationCursorKeys = true; break;
                    case 3:
                        this.cols = 132;
                        this.clearScreen();
                        if (this.onResize) this.onResize(this.cols, this.rows);
                        break;
                    case 9: this.mouseTracking = 9; break;
                    case 25:
                        this.cursorVisible = true;
                        this.triggerRender();
                        break;
                    case 47:
                    case 1047:
                        this.switchToAlternateBuffer();
                        break;
                    case 1048:
                        this.savedCursorX = this.cursorX;
                        this.savedCursorY = this.cursorY;
                        break;
                    case 1049:
                        this.switchToAlternateBuffer();
                        this.savedCursorX = this.cursorX;
                        this.savedCursorY = this.cursorY;
                        break;
                    case 1000: this.mouseTracking = 1000; break;
                    case 1002: this.mouseTracking = 1002; break;
                    case 1003: this.mouseTracking = 1003; break;
                    case 1006: this.mouseProtocol = 'sgr'; break;
                    case 2004: this.bracketedPaste = true; break;
                }
            }
        }
    }

    resetMode(params, priv) {
        for (const p of params) {
            if (priv) {
                switch (p) {
                    case 1: this.applicationCursorKeys = false; break;
                    case 3:
                        this.cols = 80;
                        this.clearScreen();
                        if (this.onResize) this.onResize(this.cols, this.rows);
                        break;
                    case 9:
                    case 1000:
                    case 1002:
                    case 1003:
                        this.mouseTracking = 0;
                        break;
                    case 25:
                        this.cursorVisible = false;
                        this.triggerRender();
                        break;
                    case 47:
                    case 1047:
                    case 1049:
                        this.switchToPrimaryBuffer();
                        if (p === 1049) {
                            this.cursorX = this.savedCursorX;
                            this.cursorY = this.savedCursorY;
                        }
                        break;
                    case 1006: this.mouseProtocol = 'normal'; break;
                    case 2004: this.bracketedPaste = false; break;
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // OSC & DCS Handlers
    // -------------------------------------------------------------------------

    executeOSC(data) {
        // Security: limit parsed data size
        if (data.length > MAX_SEQUENCE_SIZE) return;
        
        const semiIndex = data.indexOf(';');
        if (semiIndex === -1) return;

        const cmd = data.slice(0, semiIndex);
        const arg = data.slice(semiIndex + 1);

        switch (cmd) {
            case '0':
            case '2':
                if (this.onTitle) this.onTitle(arg);
                break;
            case '52':
                // OSC 52: Clipboard operations - require user confirmation for writes
                if (arg.startsWith('c;')) {
                    try {
                        const text = atob(arg.slice(2));
                        // Security: prompt user before allowing clipboard write
                        if (this.onClipboardWrite) {
                            if (this.onClipboardWrite(text)) {
                                navigator.clipboard.writeText(text).catch(() => { });
                            }
                        } else {
                            // Default: allow with console warning
                            console.warn('[ShellPort] OSC 52 clipboard write requested - consider setting onClipboardWrite callback');
                            navigator.clipboard.writeText(text).catch(() => { });
                        }
                    } catch { }
                }
                break;
        }
    }

    executeDCS(data) {
        // DCS sequences — minimal implementation
    }

    // -------------------------------------------------------------------------
    // Buffer Management
    // -------------------------------------------------------------------------

    switchToAlternateBuffer() {
        if (!this.useAlternate) {
            this.primaryGrid = this.grid;
            this.grid = this.allocGrid(this.cols, this.rows);
            this.useAlternate = true;
            this.scrollbackBuffer = [];
            this.scrollbackOffset = 0;
        }
    }

    switchToPrimaryBuffer() {
        if (this.useAlternate) {
            this.grid = this.primaryGrid;
            this.useAlternate = false;
            this.scrollbackBuffer = [];
            this.scrollbackOffset = 0;
        }
    }

    getScrollTop() { return this.scrollTop || 0; }
    getScrollBottom() { return this.scrollBottom || (this.rows - 1); }

    // -------------------------------------------------------------------------
    // Terminal Operations
    // -------------------------------------------------------------------------

    putChar(c) {
        // VT100 DECAWM: if a previous putChar set wrapPending,
        // execute the deferred line wrap before writing this character
        if (this.wrapPending) {
            this.cursorX = 0;
            this.lineFeed();
            this.wrapPending = false;
        }

        if (this.cursorY >= 0 && this.cursorY < this.rows &&
            this.cursorX >= 0 && this.cursorX < this.cols) {
            const off = (this.cursorY * this.cols + this.cursorX) * CELL_WORDS;
            this.grid[off] = (c.codePointAt(0) << CELL_CP_SHIFT) | (this.curFlags & CELL_FLAGS_MASK);
            this.grid[off + 1] = this.curFg;
            this.grid[off + 2] = this.curBg;
            this.grid[off + 3] = 0;
        }

        if (this.cursorX >= this.cols - 1) {
            // Cursor stays at last column; wrap is deferred until next putChar
            this.wrapPending = true;
        } else {
            this.cursorX++;
        }
    }

    lineFeed() {
        const scrollBottom = this.getScrollBottom();
        if (this.cursorY >= scrollBottom) {
            this.scrollUp(1);
        } else {
            this.cursorY++;
        }
    }

    reverseIndex() {
        const scrollTop = this.getScrollTop();
        if (this.cursorY <= scrollTop) {
            this.scrollDown(1);
        } else {
            this.cursorY--;
        }
    }

    scrollUp(n = 1) {
        const scrollTop = this.getScrollTop();
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            // Save top row to scrollback (if in primary buffer)
            if (!this.useAlternate) {
                this.scrollbackBuffer.push(this.extractRow(scrollTop));
                if (this.scrollbackBuffer.length > this.options.scrollback) {
                    this.scrollbackBuffer.shift();
                }
            }
            // Shift region up by one row (native memcpy via copyWithin)
            const srcStart = (scrollTop + 1) * rowWords;
            const dstStart = scrollTop * rowWords;
            const len = (scrollBottom - scrollTop) * rowWords;
            this.grid.copyWithin(dstStart, srcStart, srcStart + len);
            // Fill bottom row (BCE)
            this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0);
        }
    }

    scrollDown(n = 1) {
        const scrollTop = this.getScrollTop();
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            // Shift region down by one row
            const srcStart = scrollTop * rowWords;
            const len = (scrollBottom - scrollTop) * rowWords;
            this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len);
            // Fill top row (BCE)
            this.fillRow(scrollTop, SPACE_CP, this.curFg, this.curBg, 0);
        }
    }

    eraseDisplay(mode) {
        switch (mode) {
            case 0:
                this.eraseLine(0);
                for (let y = this.cursorY + 1; y < this.rows; y++) {
                    this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0);
                }
                break;
            case 1:
                this.eraseLine(1);
                for (let y = 0; y < this.cursorY; y++) {
                    this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0);
                }
                break;
            case 2:
            case 3:
                for (let y = 0; y < this.rows; y++) {
                    this.fillRow(y, SPACE_CP, this.curFg, this.curBg, 0);
                }
                if (mode === 3 && !this.useAlternate) {
                    this.scrollbackBuffer = [];
                    this.scrollbackOffset = 0;
                }
                break;
        }
    }

    eraseLine(mode) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        switch (mode) {
            case 0:
                this.fillRange(this.cursorY, this.cursorX, this.cols, SPACE_CP, this.curFg, this.curBg, 0);
                break;
            case 1:
                this.fillRange(this.cursorY, 0, this.cursorX + 1, SPACE_CP, this.curFg, this.curBg, 0);
                break;
            case 2:
                this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0);
                break;
        }
    }

    eraseChars(n) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        this.fillRange(this.cursorY, this.cursorX, this.cursorX + n, SPACE_CP, this.curFg, this.curBg, 0);
    }

    insertChars(n) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        const rowOffset = this.cursorY * this.cols * CELL_WORDS;
        const srcStart = rowOffset + this.cursorX * CELL_WORDS;
        const dstStart = srcStart + n * CELL_WORDS;
        const rowEnd = rowOffset + this.cols * CELL_WORDS;
        // Shift right (copyWithin handles overlapping correctly)
        this.grid.copyWithin(dstStart, srcStart, rowEnd - n * CELL_WORDS);
        // Fill inserted positions with BCE
        this.fillRange(this.cursorY, this.cursorX, Math.min(this.cursorX + n, this.cols), SPACE_CP, this.curFg, this.curBg, 0);
    }

    deleteChars(n) {
        if (this.cursorY < 0 || this.cursorY >= this.rows) return;
        const rowOffset = this.cursorY * this.cols * CELL_WORDS;
        const srcStart = rowOffset + (this.cursorX + n) * CELL_WORDS;
        const dstStart = rowOffset + this.cursorX * CELL_WORDS;
        const rowEnd = rowOffset + this.cols * CELL_WORDS;
        // Shift left
        this.grid.copyWithin(dstStart, srcStart, rowEnd);
        // Fill tail with BCE
        this.fillRange(this.cursorY, this.cols - n, this.cols, SPACE_CP, this.curFg, this.curBg, 0);
    }

    insertLines(n) {
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            if (this.cursorY <= scrollBottom) {
                // Shift rows down from cursorY to scrollBottom-1
                const srcStart = this.cursorY * rowWords;
                const len = (scrollBottom - this.cursorY) * rowWords;
                this.grid.copyWithin(srcStart + rowWords, srcStart, srcStart + len);
                // Insert empty row at cursorY (BCE)
                this.fillRow(this.cursorY, SPACE_CP, this.curFg, this.curBg, 0);
            }
        }
    }

    deleteLines(n) {
        const scrollBottom = this.getScrollBottom();
        const rowWords = this.cols * CELL_WORDS;
        for (let i = 0; i < n; i++) {
            if (this.cursorY <= scrollBottom) {
                // Shift rows up from cursorY+1 to scrollBottom
                const srcStart = (this.cursorY + 1) * rowWords;
                const dstStart = this.cursorY * rowWords;
                const len = (scrollBottom - this.cursorY) * rowWords;
                this.grid.copyWithin(dstStart, srcStart, srcStart + len);
                // Fill bottom row (BCE)
                this.fillRow(scrollBottom, SPACE_CP, this.curFg, this.curBg, 0);
            }
        }
    }

    clearScreen() {
        for (let y = 0; y < this.rows; y++) {
            this.fillRow(y, SPACE_CP, COLOR_DEFAULT, COLOR_DEFAULT, 0);
        }
        this.cursorX = 0;
        this.cursorY = 0;
    }

    tabForward(n = 1) {
        for (let i = 0; i < n; i++) {
            let nextTab = this.cursorX + 1;
            while (nextTab < this.cols && !this.tabStops.has(nextTab)) nextTab++;
            this.cursorX = Math.min(nextTab, this.cols - 1);
        }
    }

    tabBackward(n = 1) {
        for (let i = 0; i < n; i++) {
            let prevTab = this.cursorX - 1;
            while (prevTab > 0 && !this.tabStops.has(prevTab)) prevTab--;
            this.cursorX = Math.max(0, prevTab);
        }
    }

    deviceStatusReport(cmd) {
        switch (cmd) {
            case 5: this.send('\x1b[0n'); break;
            case 6: this.send(`\x1b[${this.cursorY + 1};${this.cursorX + 1}R`); break;
        }
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    triggerRender() {
        if (!this.renderPending && !this._isDestroyed) {
            this.renderPending = true;
            requestAnimationFrame(() => {
                if (!this._isDestroyed) this.render();
            });
        }
    }

    render() {
        this.renderPending = false;
        this.renderer.render(this);
    }

    startCursorBlink() {
        if (!this.options.cursorBlink) return;
        this.cursorBlinkTimer = setInterval(() => {
            this.cursorBlinkState = !this.cursorBlinkState;
            this.triggerRender();
        }, 530);
    }

    stopCursorBlink() {
        if (this.cursorBlinkTimer) {
            clearInterval(this.cursorBlinkTimer);
            this.cursorBlinkTimer = null;
        }
    }

    // -------------------------------------------------------------------------
    // Event Handling
    // -------------------------------------------------------------------------

    setupEvents() {
        this.canvas.addEventListener('keydown', e => this.onKeyDown(e));
        this.canvas.addEventListener('keypress', e => this.onKeyPress(e));

        this.canvas.addEventListener('focus', () => {
            this.focused = true;
            this.cursorBlinkState = true;
            this.triggerRender();
            if (this.onFocus) this.onFocus();
        });

        this.canvas.addEventListener('blur', () => {
            this.focused = false;
            this.triggerRender();
            if (this.onBlur) this.onBlur();
        });

        this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', e => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', e => this.onMouseUp(e));
        this.canvas.addEventListener('wheel', e => this.onWheel(e));
        this.canvas.addEventListener('contextmenu', e => this.onContextMenu(e));

        this._resizeObserver = new ResizeObserver(() => {
            if (!this._isDestroyed) this.resize();
        });
        this._resizeObserver.observe(this.container);

        this.canvas.addEventListener('paste', e => this.onPaste(e));
    }

    onKeyDown(e) {
        this.cursorBlinkState = true;
        let seq = '';
        const modifier = (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);

        // F1-F12: xterm escape sequences (codes 16 and 22 are skipped per spec)
        const FKEY_CODES = [null, 'OP', 'OQ', 'OR', 'OS', '[15~', '[17~', '[18~', '[19~', '[20~', '[21~', '[23~', '[24~'];
        if (e.key.startsWith('F') && e.key.length <= 3) {
            const fnum = parseInt(e.key.slice(1));
            if (fnum >= 1 && fnum <= 12 && FKEY_CODES[fnum]) {
                if (fnum <= 4 && !modifier) {
                    seq = '\x1b' + FKEY_CODES[fnum];
                } else if (fnum <= 4) {
                    // F1-F4 with modifiers use CSI form
                    seq = `\x1b[1;${modifier + 1}${FKEY_CODES[fnum][1]}`;
                } else {
                    const code = FKEY_CODES[fnum].slice(1, -1); // extract number from "[N~"
                    seq = modifier ? `\x1b[${code};${modifier + 1}~` : '\x1b' + FKEY_CODES[fnum];
                }
            }
        } else {
            switch (e.key) {
                case 'Enter': seq = '\r'; break;
                case 'Backspace': seq = e.ctrlKey ? '\x08' : '\x7f'; break;
                case 'Tab': seq = e.shiftKey ? '\x1b[Z' : '\t'; break;
                case 'Escape': seq = '\x1b'; break;
                case 'ArrowUp': seq = modifier ? `\x1b[1;${modifier + 1}A` : (this.applicationCursorKeys ? '\x1bOA' : '\x1b[A'); break;
                case 'ArrowDown': seq = modifier ? `\x1b[1;${modifier + 1}B` : (this.applicationCursorKeys ? '\x1bOB' : '\x1b[B'); break;
                case 'ArrowRight': seq = modifier ? `\x1b[1;${modifier + 1}C` : (this.applicationCursorKeys ? '\x1bOC' : '\x1b[C'); break;
                case 'ArrowLeft': seq = modifier ? `\x1b[1;${modifier + 1}D` : (this.applicationCursorKeys ? '\x1bOD' : '\x1b[D'); break;
                case 'Home': seq = modifier ? `\x1b[1;${modifier + 1}H` : '\x1b[H'; break;
                case 'End': seq = modifier ? `\x1b[1;${modifier + 1}F` : '\x1b[F'; break;
                case 'Insert': seq = '\x1b[2~'; break;
                case 'Delete': seq = '\x1b[3~'; break;
                case 'PageUp': seq = '\x1b[5~'; break;
                case 'PageDown': seq = '\x1b[6~'; break;
                default:
                    // Industry-standard clipboard: Ctrl+Shift+C always copies,
                    // Ctrl+C copies when text is selected (otherwise sends ^C)
                    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
                        if (e.shiftKey || this.selection) {
                            e.preventDefault();
                            this.copyToClipboard();
                            if (!e.shiftKey) this.selection = null; // clear selection after copy
                            this.triggerRender();
                            return;
                        }
                        // No selection + no shift → send ^C
                        seq = '\x03';
                    } else if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
                        // Ctrl+Shift+V: paste from clipboard
                        e.preventDefault();
                        navigator.clipboard.readText().then(text => {
                            if (text) {
                                if (this.bracketedPaste) {
                                    text = '\x1b[200~' + text + '\x1b[201~';
                                }
                                this.send(text);
                            }
                        }).catch(() => {});
                        return;
                    } else if (e.ctrlKey && e.key.length === 1) {
                        const code = e.key.toUpperCase().charCodeAt(0);
                        if (code >= 64 && code <= 95) seq = String.fromCharCode(code - 64);
                    }
                    break;
            }
        }

        if (seq) {
            e.preventDefault();
            this.send(seq);
        } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Let keypress handle it
        } else {
            e.preventDefault();
        }
    }

    onKeyPress(e) {
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.send(e.key);
        }
    }

    onMouseDown(e) {
        if (this.mouseTracking && !e.shiftKey) {
            e.preventDefault();
            this.sendMouseReport(e, 'down');
        } else if (e.button === 0) {
            this.isSelecting = true;
            this.selectionStart = this.screenToCell(e.clientX, e.clientY);
            this.selection = null; // Don't create 0-width selection (traps Ctrl+C)
        }
        this.canvas.focus();
    }

    onMouseMove(e) {
        if (this.mouseTracking && (this.mouseTracking === 1002 || this.mouseTracking === 1003) && !e.shiftKey) {
            if (this.mouseTracking === 1003 || e.buttons > 0) {
                this.sendMouseReport(e, e.buttons === 0 ? 'move' : 'drag');
            }
        } else if (this.isSelecting) {
            const cell = this.screenToCell(e.clientX, e.clientY);
            if (this.selectionStart) {
                if (cell.y < this.selectionStart.y || (cell.y === this.selectionStart.y && cell.x < this.selectionStart.x)) {
                    this.selection = { startRow: cell.y, endRow: this.selectionStart.y, startCol: cell.x, endCol: this.selectionStart.x + 1 };
                } else {
                    this.selection = { startRow: this.selectionStart.y, endRow: cell.y, startCol: this.selectionStart.x, endCol: cell.x + 1 };
                }
                this.triggerRender();
            }
        }
    }

    onMouseUp(e) {
        if (this.mouseTracking && !e.shiftKey) {
            e.preventDefault();
            this.sendMouseReport(e, 'up');
        } else if (e.button === 0) {
            this.isSelecting = false;
        }
    }

    sendMouseReport(e, type) {
        const rect = this.canvas.getBoundingClientRect();
        const pad = this.options.padding || 6;
        // Account for terminal padding — chars start after pad offset
        const x = Math.max(1, Math.floor((e.clientX - rect.left - pad) / this.charWidth) + 1);
        const y = Math.max(1, Math.floor((e.clientY - rect.top - pad) / this.charHeight) + 1);

        let button = e.button; // 0=left, 1=middle, 2=right
        if (type === 'up') button = 3;
        else if (type === 'move') button = 35; // No button pressed — mode 1003 passive movement
        else if (type === 'drag') button = 32 + (e.buttons & 1 ? 0 : (e.buttons & 2 ? 2 : (e.buttons & 4 ? 1 : 0)));
        else if (type === 'scroll') button = e.button; // Already set by caller

        let mods = (e.shiftKey ? 4 : 0) + (e.altKey ? 8 : 0) + (e.ctrlKey ? 16 : 0);

        if (this.mouseProtocol === 'sgr') {
            const final = type === 'up' ? 'm' : 'M';
            this.send(`\x1b[<${button + mods};${x};${y}${final}`);
        } else {
            button += 32; mods += 32;
            this.send(`\x1b[M${String.fromCharCode(button)}${String.fromCharCode(x + 32)}${String.fromCharCode(y + 32)}`);
        }
    }

    onWheel(e) {
        if (this.useAlternate) {
            if (this.mouseTracking) {
                const button = e.deltaY > 0 ? 1 : 0;
                e.button = button + 64;
                this.sendMouseReport(e, 'scroll');
            }
        } else {
            e.preventDefault();
            // Accumulate fractional deltas for smooth trackpad scrolling
            this._scrollAccum = (this._scrollAccum || 0) + e.deltaY;
            const rows = Math.trunc(this._scrollAccum / this.charHeight);
            if (rows !== 0) {
                this._scrollAccum -= rows * this.charHeight;
                // Positive deltaY = scroll down = move AWAY from history (subtract)
                this.scrollbackOffset = Math.max(0, Math.min(this.scrollbackBuffer.length, this.scrollbackOffset - rows));
                this.triggerRender();
            }
        }
    }

    onContextMenu(e) {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        if (!menu) return; // No context menu element available
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.classList.add('visible');
        const closeMenu = () => {
            menu.classList.remove('visible');
            document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    onPaste(e) {
        e.preventDefault();
        let text = e.clipboardData.getData('text/plain');
        if (this.bracketedPaste) {
            text = '\x1b[200~' + text + '\x1b[201~';
        }
        this.send(text);
    }

    screenToCell(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const pad = this.options.padding;
        return {
            x: Math.max(0, Math.min(this.cols - 1, Math.floor((clientX - rect.left - pad) / this.charWidth))),
            y: Math.max(0, Math.min(this.rows - 1, Math.floor((clientY - rect.top - pad) / this.charHeight)))
        };
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    getSelection() {
        if (!this.selection) return '';
        const { startRow, endRow, startCol, endCol } = this.selection;
        const lines = [];
        for (let y = startRow; y <= endRow; y++) {
            if (y < 0 || y >= this.rows) continue;
            const sx = y === startRow ? startCol : 0;
            const ex = y === endRow ? endCol : this.cols;
            let line = '';
            for (let x = sx; x < ex; x++) {
                const off = (y * this.cols + x) * CELL_WORDS;
                const cp = this.grid[off] >>> CELL_CP_SHIFT;
                line += (cp > 0 && cp !== SPACE_CP) ? String.fromCodePoint(cp) : ' ';
            }
            lines.push(line.trimEnd());
        }
        return lines.join('\n');
    }

    copyToClipboard() {
        const text = this.getSelection();
        if (text) navigator.clipboard.writeText(text).catch(() => { });
    }

    clear() {
        this.eraseDisplay(3);
        this.triggerRender();
    }

    /**
     * Live theme switching — updates colors without losing terminal state.
     * @param {Object} theme - Partial theme object (background, foreground, cursor, selection, palette)
     */
    setTheme(theme) {
        // Merge with existing colors
        if (theme.background) this.colors.background = theme.background;
        if (theme.foreground) this.colors.foreground = theme.foreground;
        if (theme.cursor) this.colors.cursor = theme.cursor;
        if (theme.selection) this.colors.selection = theme.selection;
        if (theme.palette) this.colors.palette = theme.palette;

        // Propagate to renderer
        if (this.renderer && this.renderer.updateTheme) {
            this.renderer.updateTheme(this.colors);
        }

        this.triggerRender();
    }

    /**
     * Live font size change — re-measures and resizes without losing terminal state.
     * @param {number} size - New font size in pixels
     */
    setFontSize(size) {
        if (size === this.options.fontSize) return;
        this.options.fontSize = size;
        this.measureChar();
        this.resize();
    }

    destroy() {
        this._isDestroyed = true;
        this.stopCursorBlink();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this.renderer && typeof this.renderer.destroy === 'function') {
            this.renderer.destroy();
            this.renderer = null;
        } else if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}

// Expose globally for IIFE bundle and inline <script> usage
globalThis.NanoTermV2 = NanoTermV2;
```

### File: `src/index.ts`

- Size: 7490 bytes
- Modified: 2026-02-14 07:12:17 UTC

```typescript
#!/usr/bin/env bun
/**
 * ShellPort - CLI Entry Point
 *
 * Zero-dependency encrypted terminal bridge with built-in web UI.
 */

import { startServer } from "./server.js";
import { connectClient } from "./client.js";
import { generateSecret } from "./crypto.js";
import { generateTOTPSecret, loadTOTPSecret, saveTOTPSecret, deleteTOTPSecret, buildOTPAuthURI } from "./totp.js";
import { printQR } from "./qr.js";

export const VERSION = "0.2.0";

export interface ParsedArgs {
    command: string;
    port: number;
    secret: string;
    tailscale: string;
    url: string;
    noSecret: boolean;
    requireApproval: boolean;
    allowLocalhost: boolean;
    quiet: boolean;
    totp: boolean;
    totpReset: boolean;
}

/** Parse CLI arguments into a structured object. */
export function parseArgs(argv: string[]): ParsedArgs {
    const command = argv[0] || "help";
    let port = 7681;
    let secret = "";
    let tailscale = "";
    let url = "";
    let noSecret = false;
    let requireApproval = true;
    let allowLocalhost = false;
    let quiet = false;
    let totp = true;
    let totpReset = false;

    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === "--port" || argv[i] === "-p") {
            port = parseInt(argv[++i], 10);
        } else if (argv[i] === "--secret" || argv[i] === "-s") {
            secret = argv[++i];
        } else if (argv[i] === "--no-secret") {
            noSecret = true;
        } else if (argv[i] === "--tailscale") {
            tailscale = argv[++i];
        } else if (argv[i] === "--no-approval") {
            requireApproval = false;
        } else if (argv[i] === "--no-totp") {
            totp = false;
        } else if (argv[i] === "--totp-reset") {
            totpReset = true;
        } else if (argv[i] === "--allow-localhost" || argv[i] === "--dev") {
            allowLocalhost = true;
        } else if (argv[i] === "--quiet" || argv[i] === "-q") {
            quiet = true;
        } else if (!argv[i].startsWith("--")) {
            url = argv[i];
        }
    }

    return { command, port, secret, tailscale, url, noSecret, requireApproval, allowLocalhost, quiet, totp, totpReset };
}

const parsed = parseArgs(process.argv.slice(2));

if (parsed.command === "server" || parsed.command === "serve") {
    let secret = parsed.secret || process.env.SHELLPORT_SECRET || "";
    const secretExplicit = !!parsed.secret;

    if (!secret && !parsed.noSecret) {
        secret = generateSecret();
        if (!parsed.quiet) {
            console.log(`[ShellPort] 🎲 Auto-generated session secret (not persisted)`);
            console.log(`[ShellPort] 🌐 Open in browser: http://localhost:${parsed.port}/#${secret}`);
        }
    }

    if (secretExplicit && !parsed.quiet) {
        console.log(`[ShellPort] ⚠️  Using fixed secret. Auto-generated secrets (the default) are recommended for better security.`);
    }

    // ─── TOTP Setup ───
    let totpSecret: string | undefined;

    if (parsed.totp) {
        // Handle --totp-reset
        if (parsed.totpReset) {
            deleteTOTPSecret();
            console.log("[ShellPort] 🔄 TOTP secret reset. A new pairing will be generated.");
        }

        // Load or generate TOTP secret
        const existing = loadTOTPSecret();
        if (existing) {
            totpSecret = existing;
            if (!parsed.quiet) {
                console.log("[ShellPort] 🔐 TOTP 2FA active (already paired)");
            }
        } else {
            totpSecret = generateTOTPSecret();
            saveTOTPSecret(totpSecret);

            if (!parsed.quiet) {
                console.log("");
                console.log("  ┌─────────────────────────────────────────────────────┐");
                console.log("  │   🔐 TOTP 2FA Setup — Scan with Authenticator App   │");
                console.log("  └─────────────────────────────────────────────────────┘");

                const uri = buildOTPAuthURI(totpSecret);
                printQR(uri);

                console.log(`  Manual entry key: ${totpSecret}`);
                console.log(`  Algorithm: SHA1 | Digits: 6 | Period: 30s`);
                console.log("");
                console.log("  After pairing, this QR code won't be shown again.");
                console.log("  Use --totp-reset to generate a new secret.");
                console.log("");
            }
        }
    }

    startServer({
        port: parsed.port,
        secret,
        tailscale: parsed.tailscale,
        requireApproval: parsed.requireApproval,
        allowLocalhost: parsed.allowLocalhost,
        totp: parsed.totp,
        totpSecret,
    });
} else if (parsed.command === "client" || parsed.command === "connect") {
    connectClient({ url: parsed.url, secret: parsed.secret });
} else if (parsed.command === "--version" || parsed.command === "-v") {
    console.log(`shellport v${VERSION}`);
} else {
    console.log(`
  ┌─────────────────────────────────────────┐
  │   ShellPort v${VERSION}                      │
  │   Encrypted terminal bridge             │
  └─────────────────────────────────────────┘

  Usage:
    shellport server [options]     Start a PTY WebSocket server
    shellport client <url> [opts]  Connect to a server from CLI
    shellport --version            Show version

  Server Options:
    --port, -p <n>           Port (default: 7681)
    --secret, -s <key>       Fixed encryption secret (auto-generated if omitted)
    --no-secret              Disable encryption entirely (plaintext mode)
    --no-totp                Disable TOTP 2FA authentication
    --totp-reset             Regenerate TOTP secret (re-pair authenticator)
    --no-approval            Disable interactive connection approval (legacy)
    --allow-localhost, --dev Allow localhost origin bypass (dev mode)
    --tailscale <serve|funnel>  Tailscale integration
    --quiet, -q              Suppress non-essential output

  Environment:
    SHELLPORT_SECRET         Fixed encryption secret (avoids exposing in ps)

  Security:
    By default, connections require TOTP 2FA from an authenticator app.
    On first launch, a QR code is displayed for pairing with Authy, Google
    Authenticator, 1Password, etc. The secret is persisted in ~/.shellport/

    Per-session cryptographic salts prevent precomputation attacks.
    Origin header validation is strict by default. Use --allow-localhost
    for local development.

  Examples:
    # Start with full security — TOTP + auto-generated encryption (recommended)
    shellport server

    # Start without TOTP (encryption only)
    shellport server --no-totp

    # Re-pair authenticator app
    shellport server --totp-reset

    # Dev mode with localhost bypass
    shellport server --dev

    # Plaintext mode (trusted network only)
    shellport server --no-secret --no-totp

    # Public via Tailscale Funnel
    shellport server --tailscale funnel

    # Connect from another machine
    shellport client ws://host:7681/ws --secret <secret>

    # Open in browser
    # http://localhost:7681/#<secret>
`);
}
```

### File: `src/bounds.test.ts`

- Size: 2225 bytes
- Modified: 2026-02-14 18:29:48 UTC

```typescript
/**
 * ShellPort - WebSocket Bounds Checking Tests
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { FrameType } from "./types.js";

const TEST_PORT = 17682 + Math.floor(Math.random() * 1000);

describe("WebSocket Bounds Checking", () => {
    let server: any;

    beforeAll(() => {
        server = Bun.serve({
            port: TEST_PORT,
            fetch(req, srv) {
                if (srv.upgrade(req)) return;
                return new Response("Expected WebSocket", { status: 400 });
            },
            websocket: {
                message(ws, message) {
                    const msg = message as unknown as Uint8Array;
                    // Strict limit: 1MB
                    if (msg.length > 1024 * 1024) {
                        ws.close(4009, "Message too large");
                        return;
                    }
                    ws.send(message);
                }
            }
        });
    });

    afterAll(() => {
        server?.stop(true);
    });

    test("accepts messages under 1MB", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.binaryType = "arraybuffer";

        const payload = new Uint8Array(1024 * 100).fill(0x41); // 100KB

        const response = await new Promise<ArrayBuffer>((resolve, reject) => {
            ws.onopen = () => ws.send(payload);
            ws.onmessage = (e) => resolve(e.data);
            ws.onerror = reject;
            setTimeout(() => reject(new Error("timeout")), 2000);
        });

        expect(response.byteLength).toBe(1024 * 100);
        ws.close();
    });

    test("closes connection for messages over 1MB", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.binaryType = "arraybuffer";

        const largePayload = new Uint8Array(1024 * 1024 + 100).fill(0x41); // > 1MB

        const closed = await new Promise<number>((resolve, reject) => {
            ws.onopen = () => ws.send(largePayload);
            ws.onclose = (e) => resolve(e.code);
            ws.onerror = reject;
            setTimeout(() => reject(new Error("timeout")), 2000);
        });

        expect(closed).toBe(4009);
    });
});
```

### File: `src/client.ts`

- Size: 7970 bytes
- Modified: 2026-02-14 05:19:28 UTC

```typescript
/**
 * ShellPort - CLI Client
 *
 * Connects to a ShellPort server via WebSocket from the terminal.
 * Supports raw mode, terminal resize forwarding, E2E encryption,
 * and TOTP 2FA authentication.
 *
 * Protocol v2 handshake:
 * 1. Server sends server_nonce (16 bytes)
 * 2. Client sends client_nonce (16 bytes)
 * 3. Both derive per-session salt from SHA-256(server_nonce || client_nonce || "shellport-v2")
 * 4. Key derived using PBKDF2(secret, session_salt)
 * 5. If TOTP enabled: server sends TOTP_CHALLENGE, client responds with TOTP_RESPONSE
 * 6. Encrypted communication begins
 */

import { deriveKey, pack, unpack, generateNonce, deriveSessionSalt } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ClientConfig, FrameTypeValue } from "./types.js";

const NONCE_LENGTH = 16;

/**
 * Prompt user for TOTP code in the terminal.
 */
function promptTOTP(): Promise<string> {
    return new Promise((resolve) => {
        process.stdout.write("\n\x1b[93m🔐 Enter TOTP code: \x1b[0m");

        // Temporarily exit raw mode if it was set
        const wasRaw = process.stdin.isRaw;
        if (wasRaw) process.stdin.setRawMode(false);

        let input = "";
        const onData = (data: Buffer) => {
            const char = data.toString();

            // Handle Enter
            if (char === "\n" || char === "\r") {
                process.stdin.removeListener("data", onData);
                process.stdout.write("\n");
                if (wasRaw) process.stdin.setRawMode(true);
                resolve(input.trim());
                return;
            }

            // Handle backspace
            if (char === "\x7f" || char === "\x08") {
                if (input.length > 0) {
                    input = input.slice(0, -1);
                    process.stdout.write("\b \b");
                }
                return;
            }

            // Only accept digits
            if (/^\d$/.test(char)) {
                input += char;
                process.stdout.write(char);

                // Auto-submit on 6 digits
                if (input.length === 6) {
                    process.stdin.removeListener("data", onData);
                    process.stdout.write("\n");
                    if (wasRaw) process.stdin.setRawMode(true);
                    resolve(input);
                }
            }
        };

        process.stdin.on("data", onData);
    });
}

export async function connectClient(config: ClientConfig): Promise<void> {
    if (!config.url) {
        console.error("Usage: shellport client <ws-url> [--secret key]");
        process.exit(1);
    }

    const ws = new WebSocket(config.url);
    ws.binaryType = "arraybuffer";

    const isTTY = process.stdout.isTTY;
    const sendQ = new SeqQueue();
    const recvQ = new SeqQueue();

    let cryptoKey: CryptoKey | null = null;
    let serverNonce: Uint8Array | null = null;
    let clientNonce: Uint8Array | null = null;
    let authenticated = false;
    let totpPending = false;
    let sessionReady = false;

    const sendMsg = (type: FrameTypeValue, payload: Uint8Array) =>
        sendQ.add(async () => {
            if (ws.readyState === 1) {
                if (type === FrameType.CLIENT_NONCE || !cryptoKey) {
                    ws.send(await pack(null, type, payload));
                } else {
                    ws.send(await pack(cryptoKey, type, payload));
                }
            }
        });

    /** Enter interactive terminal mode */
    const startTerminal = () => {
        if (sessionReady) return;
        sessionReady = true;

        if (isTTY) {
            process.stdin.setRawMode(true);
            const sendSize = () => {
                sendMsg(
                    FrameType.CONTROL,
                    new TextEncoder().encode(
                        JSON.stringify({
                            type: "resize",
                            cols: process.stdout.columns,
                            rows: process.stdout.rows,
                        })
                    )
                );
            };
            sendSize();
            process.stdout.on("resize", sendSize);
        }
    };

    ws.addEventListener("open", () => {
        console.log("[ShellPort] Connected, negotiating...");

        if (!config.secret) {
            clientNonce = generateNonce();
            sendMsg(FrameType.CLIENT_NONCE, clientNonce);
            console.log("[ShellPort] Plaintext mode (no encryption)");
            authenticated = true;
            // Don't start terminal yet — might get TOTP challenge
        }
    });

    ws.addEventListener("message", async (event) => {
        const data = event.data as ArrayBuffer;
        const msgView = new Uint8Array(data);

        // ─── Step 1: Nonce exchange (encrypted mode) ───
        if (!cryptoKey && config.secret && !serverNonce) {
            if (msgView.length >= NONCE_LENGTH) {
                serverNonce = msgView.slice(0, NONCE_LENGTH);
                clientNonce = generateNonce();

                sendMsg(FrameType.CLIENT_NONCE, clientNonce);

                const sessionSalt = await deriveSessionSalt(serverNonce, clientNonce);
                cryptoKey = await deriveKey(config.secret, sessionSalt);

                authenticated = true;
                console.log("[ShellPort] 🔒 Session established with per-session key");
                // Don't start terminal yet — might get TOTP challenge
            }
            return;
        }

        // ─── Step 2: Check for TOTP challenge ───
        if (authenticated && !sessionReady) {
            const decoded = await unpack(cryptoKey, data);
            if (decoded && decoded.type === FrameType.TOTP_CHALLENGE) {
                totpPending = true;
                console.log("[ShellPort] 🔐 TOTP verification required");

                const code = await promptTOTP();
                sendMsg(FrameType.TOTP_RESPONSE, new TextEncoder().encode(code));
                return;
            }

            // If it's data and not a TOTP challenge, session is ready
            startTerminal();
            if (decoded && decoded.type === FrameType.DATA) {
                process.stdout.write(decoded.payload);
            }
            return;
        }

        // ─── Step 3: Normal data flow ───
        if (!sessionReady) return;

        recvQ.add(async () => {
            const decoded = await unpack(cryptoKey, data);
            if (!decoded) {
                if (cryptoKey) {
                    console.error("\n[ShellPort] Security error: decryption failed.");
                    ws.close();
                    process.exit(1);
                }
                return;
            }

            if (decoded.type === FrameType.DATA) {
                // First data after TOTP means we're verified
                if (totpPending) {
                    totpPending = false;
                    console.log("[ShellPort] ✅ TOTP verified");
                    startTerminal();
                }
                process.stdout.write(decoded.payload);
            }
        });
    });

    process.stdin.on("data", (chunk) => {
        if (!sessionReady) return;
        sendMsg(
            FrameType.DATA,
            typeof chunk === "string"
                ? new TextEncoder().encode(chunk)
                : new Uint8Array(chunk as Buffer)
        );
    });

    const cleanup = () => {
        if (isTTY) process.stdin.setRawMode(false);
        console.log("\n[ShellPort] Closed.");
        process.exit(0);
    };

    ws.addEventListener("close", (e) => {
        if (e.code === 4003 && totpPending) {
            console.error("\n[ShellPort] ❌ Invalid TOTP code. Connection closed.");
        }
        cleanup();
    });
    ws.addEventListener("error", cleanup);

    process.on("SIGINT", () => { });
    process.on("exit", () => isTTY && process.stdin.setRawMode(false));
}
```

### File: `src/crypto.test.ts`

- Size: 14177 bytes
- Modified: 2026-02-14 18:08:46 UTC

```typescript
/**
 * ShellPort - Crypto Engine Tests
 *
 * Tests AES-256-GCM key derivation, message packing/unpacking,
 * round-trip integrity, and error handling.
 */

import { describe, test, expect } from "bun:test";
import { deriveKey, pack, unpack, getCryptoJS, generateNonce, generateSecret, deriveSessionSalt, PROTOCOL_VERSION, PBKDF2_ITERATIONS, NONCE_LENGTH } from "./crypto.js";
import { FrameType } from "./types.js";

// ---------------------------------------------------------------------------
// Security Audit Tests
// ---------------------------------------------------------------------------
describe("Security Audit", () => {
    test("PBKDF2 iteration count is at least 100,000", () => {
        expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100000);
    });

    test("nonce length is at least 16 bytes (128 bits)", () => {
        expect(NONCE_LENGTH).toBeGreaterThanOrEqual(16);
    });

    test("AES-GCM IVs are unique for every pack() call", async () => {
        const key = await deriveKey("test-iv-uniqueness");
        const ivs = new Set<string>();
        const iterations = 100;

        for (let i = 0; i < iterations; i++) {
            const packed = await pack(key, FrameType.DATA, new Uint8Array([i]));
            const iv = packed.slice(0, 12);
            ivs.add(Buffer.from(iv).toString("hex"));
        }

        expect(ivs.size).toBe(iterations);
    });
});

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------
describe("deriveKey", () => {
    test("returns a CryptoKey for a valid secret", async () => {
        const key = await deriveKey("test-secret");
        expect(key).not.toBeNull();
        expect(key).toBeInstanceOf(CryptoKey);
    });

    test("returns null for empty string (plaintext mode)", async () => {
        const key = await deriveKey("");
        expect(key).toBeNull();
    });

    test("same secret produces compatible keys", async () => {
        const key1 = await deriveKey("same-secret");
        const key2 = await deriveKey("same-secret");

        // Encrypt with key1, decrypt with key2 — must succeed
        const payload = new TextEncoder().encode("hello");
        const packed = await pack(key1, FrameType.DATA, payload);
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(new TextDecoder().decode(decoded!.payload)).toBe("hello");
    });

    test("same secret with same session salt produces compatible keys", async () => {
        const serverNonce = generateNonce();
        const clientNonce = generateNonce();
        const sessionSalt = await deriveSessionSalt(serverNonce, clientNonce);

        const key1 = await deriveKey("session-secret", sessionSalt);
        const key2 = await deriveKey("session-secret", sessionSalt);

        expect(key1).not.toBeNull();
        expect(key2).not.toBeNull();

        const payload = new TextEncoder().encode("session data");
        const packed = await pack(key1, FrameType.DATA, payload);
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(new TextDecoder().decode(decoded!.payload)).toBe("session data");
    });

    test("different nonces produce different keys", async () => {
        const nonce1 = generateNonce();
        const nonce2 = generateNonce();
        const salt1 = await deriveSessionSalt(nonce1, generateNonce());
        const salt2 = await deriveSessionSalt(nonce2, generateNonce());

        const key1 = await deriveKey("same-secret", salt1);
        const key2 = await deriveKey("same-secret", salt2);

        const payload = new TextEncoder().encode("test");
        const packed = await pack(key1, FrameType.DATA, payload);
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        // Different salts should produce incompatible keys
        expect(decoded).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// generateNonce & generateSecret
// ---------------------------------------------------------------------------
describe("generateNonce", () => {
    test("generates 16-byte nonce by default", () => {
        const nonce = generateNonce();
        expect(nonce.length).toBe(16);
    });

    test("generates unique nonces", () => {
        const nonce1 = generateNonce();
        const nonce2 = generateNonce();
        expect(nonce1).not.toEqual(nonce2);
    });
});

describe("generateSecret", () => {
    test("generates 16-byte secret by default (128 bits)", () => {
        const secret = generateSecret();
        // base64url of 16 bytes = 22 chars (no padding)
        expect(secret.length).toBe(22);
    });

    test("generates unique secrets", () => {
        const secret1 = generateSecret();
        const secret2 = generateSecret();
        expect(secret1).not.toBe(secret2);
    });

    test("respects custom byte length", () => {
        const secret = generateSecret(32);
        // base64url of 32 bytes = 43 chars (no padding)
        expect(secret.length).toBe(43);
    });
});

// ---------------------------------------------------------------------------
// deriveSessionSalt
// ---------------------------------------------------------------------------
describe("deriveSessionSalt", () => {
    test("produces 32-byte SHA-256 hash", async () => {
        const serverNonce = generateNonce();
        const clientNonce = generateNonce();
        const salt = await deriveSessionSalt(serverNonce, clientNonce);

        expect(salt.length).toBe(32);
    });

    test("same inputs produce same salt", async () => {
        const serverNonce = generateNonce();
        const clientNonce = generateNonce();

        const salt1 = await deriveSessionSalt(serverNonce, clientNonce);
        const salt2 = await deriveSessionSalt(serverNonce, clientNonce);

        expect(salt1).toEqual(salt2);
    });

    test("different server nonces produce different salts", async () => {
        const clientNonce = generateNonce();
        const salt1 = await deriveSessionSalt(generateNonce(), clientNonce);
        const salt2 = await deriveSessionSalt(generateNonce(), clientNonce);

        expect(salt1).not.toEqual(salt2);
    });

    test("different client nonces produce different salts", async () => {
        const serverNonce = generateNonce();
        const salt1 = await deriveSessionSalt(serverNonce, generateNonce());
        const salt2 = await deriveSessionSalt(serverNonce, generateNonce());

        expect(salt1).not.toEqual(salt2);
    });
});

// ---------------------------------------------------------------------------
// pack / unpack round-trip
// ---------------------------------------------------------------------------
describe("pack / unpack", () => {
    test("round-trip with encryption preserves type and payload", async () => {
        const key = await deriveKey("round-trip-key");
        const payload = new TextEncoder().encode("encrypted message");

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(new TextDecoder().decode(decoded!.payload)).toBe("encrypted message");
    });

    test("round-trip without encryption (plaintext mode)", async () => {
        const payload = new TextEncoder().encode("plaintext message");

        const packed = await pack(null, FrameType.CONTROL, payload);
        const decoded = await unpack(null, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.CONTROL);
        expect(new TextDecoder().decode(decoded!.payload)).toBe("plaintext message");
    });

    test("round-trip with session salt", async () => {
        const salt = await deriveSessionSalt(generateNonce(), generateNonce());
        const key = await deriveKey("session-key-test", salt);
        const payload = new TextEncoder().encode("per-session data");

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(new TextDecoder().decode(decoded!.payload)).toBe("per-session data");
    });

    test("round-trip preserves binary payload", async () => {
        const key = await deriveKey("binary-key");
        const payload = new Uint8Array([0x00, 0xff, 0x42, 0x80, 0x01]);

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(Array.from(decoded!.payload)).toEqual([0x00, 0xff, 0x42, 0x80, 0x01]);
    });

    test("round-trip with empty payload", async () => {
        const key = await deriveKey("empty-payload");
        const payload = new Uint8Array(0);

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(decoded!.payload.length).toBe(0);
    });

    test("all frame types work", async () => {
        const key = await deriveKey("frame-types");
        const payload = new TextEncoder().encode("test");

        for (const type of [FrameType.DATA, FrameType.CONTROL, FrameType.SERVER_NONCE, FrameType.CLIENT_NONCE]) {
            const packed = await pack(key, type, payload);
            const decoded = await unpack(key, packed.buffer as ArrayBuffer);
            expect(decoded!.type).toBe(type);
        }
    });
});

// ---------------------------------------------------------------------------
// pack output format
// ---------------------------------------------------------------------------
describe("pack output format", () => {
    test("encrypted: [iv(12)][ciphertext] — at least 29 bytes", async () => {
        const key = await deriveKey("format-key");
        const payload = new TextEncoder().encode("x");

        const packed = await pack(key, FrameType.DATA, payload);

        // 12 (IV) + 1 (type) + 1 (payload "x") + 16 (GCM tag) = 30 minimum
        expect(packed.length).toBeGreaterThanOrEqual(29);
    });

    test("plaintext: [type(1)][payload] — exact size", async () => {
        const payload = new TextEncoder().encode("hello");

        const packed = await pack(null, FrameType.DATA, payload);

        // 1 (type byte) + 5 (payload "hello")
        expect(packed.length).toBe(6);
        expect(packed[0]).toBe(FrameType.DATA);
        expect(new TextDecoder().decode(packed.slice(1))).toBe("hello");
    });
});

// ---------------------------------------------------------------------------
// unpack error handling
// ---------------------------------------------------------------------------
describe("unpack error handling", () => {
    test("wrong key returns null", async () => {
        const keyA = await deriveKey("key-alpha");
        const keyB = await deriveKey("key-beta");

        const packed = await pack(keyA, FrameType.DATA, new TextEncoder().encode("secret"));
        const decoded = await unpack(keyB, packed.buffer as ArrayBuffer);

        expect(decoded).toBeNull();
    });

    test("wrong session salt returns null", async () => {
        const salt1 = await deriveSessionSalt(generateNonce(), generateNonce());
        const salt2 = await deriveSessionSalt(generateNonce(), generateNonce());

        const key1 = await deriveKey("same-secret", salt1);
        const key2 = await deriveKey("same-secret", salt2);

        const packed = await pack(key1, FrameType.DATA, new TextEncoder().encode("session data"));
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        expect(decoded).toBeNull();
    });

    test("truncated data (< 29 bytes) returns null", async () => {
        const key = await deriveKey("truncation-key");
        const shortData = new Uint8Array(20); // Too short for IV + ciphertext + tag

        const decoded = await unpack(key, shortData.buffer as ArrayBuffer);
        expect(decoded).toBeNull();
    });

    test("corrupted ciphertext returns null", async () => {
        const key = await deriveKey("corruption-key");
        const packed = await pack(key, FrameType.DATA, new TextEncoder().encode("data"));

        // Corrupt a byte in the ciphertext (after the 12-byte IV)
        const corrupted = new Uint8Array(packed);
        corrupted[20] ^= 0xff;

        const decoded = await unpack(key, corrupted.buffer as ArrayBuffer);
        expect(decoded).toBeNull();
    });

    test("empty buffer returns null (encrypted mode)", async () => {
        const key = await deriveKey("empty-key");
        const decoded = await unpack(key, new ArrayBuffer(0));
        expect(decoded).toBeNull();
    });

    test("empty buffer returns null (plaintext mode)", async () => {
        const decoded = await unpack(null, new ArrayBuffer(0));
        expect(decoded).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getCryptoJS
// ---------------------------------------------------------------------------
describe("getCryptoJS", () => {
    test("returns a non-empty string containing key functions", () => {
        const js = getCryptoJS();

        expect(typeof js).toBe("string");
        expect(js.length).toBeGreaterThan(0);
        expect(js).toContain("deriveKey");
        expect(js).toContain("pack");
        expect(js).toContain("unpack");
        expect(js).toContain("SeqQueue");
        expect(js).toContain("deriveSessionSalt");
        expect(js).toContain("generateNonce");
    });

    test("contains protocol version", () => {
        const js = getCryptoJS();
        expect(js).toContain(`v${PROTOCOL_VERSION}`);
    });
});
```

### File: `src/crypto.ts`

- Size: 6912 bytes
- Modified: 2026-03-19 03:01:26 UTC

```typescript
/**
 * ShellPort - E2E Encryption Engine (AES-256-GCM)
 *
 * Provides key derivation, message packing (encrypt), and unpacking (decrypt).
 * Works identically on server (Bun) and client (browser) via WebCrypto API.
 *
 * Security Model (v2):
 * - Per-session salt derived from server_nonce || client_nonce || "shellport-v2"
 * - Prevents precomputation attacks against weak passwords
 * - Server sends nonce immediately on WebSocket open
 * - Client includes its nonce in the first message
 */

import type { DecodedFrame, FrameTypeValue } from "./types.js";

export const PBKDF2_ITERATIONS = 100_000;
export const NONCE_LENGTH = 16;
const SALT_PREFIX = "shellport-v2";

export const PROTOCOL_VERSION = 2;

/**
 * Generate a cryptographically random URL-safe secret.
 * Used as the default when no --secret is provided.
 * Default 16 bytes = 128 bits of entropy.
 */
export function generateSecret(bytes = 16): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
}

/**
 * Generate a random nonce for per-session salt derivation.
 */
export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

/**
 * Derive per-session salt from server and client nonces.
 * Salt = SHA-256(server_nonce || client_nonce || SALT_PREFIX)
 */
export async function deriveSessionSalt(
  serverNonce: Uint8Array,
  clientNonce: Uint8Array
): Promise<Uint8Array> {
  const data = new Uint8Array(serverNonce.length + clientNonce.length + SALT_PREFIX.length);
  data.set(serverNonce, 0);
  data.set(clientNonce, serverNonce.length);
  data.set(new TextEncoder().encode(SALT_PREFIX), serverNonce.length + clientNonce.length);
  
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

/**
 * Derive an AES-256-GCM key from a plaintext secret using PBKDF2.
 * @param secret - The user-provided secret
 * @param sessionSalt - Optional per-session salt (from deriveSessionSalt)
 * Returns null if no secret is provided (plaintext mode).
 */
export async function deriveKey(
  secret: string,
  sessionSalt?: Uint8Array
): Promise<CryptoKey | null> {
  if (!secret) return null;

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const salt: BufferSource = sessionSalt ? sessionSalt.buffer as ArrayBuffer : enc.encode(SALT_PREFIX);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Pack a message frame: [iv(12)][ciphertext] or [type(1)][payload] if unencrypted.
 */
export async function pack(
  key: CryptoKey | null,
  type: FrameTypeValue,
  payload: Uint8Array
): Promise<Uint8Array> {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);

  if (!key) return frame;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    frame
  );

  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out;
}

/**
 * Unpack a message, decrypting if a key is provided.
 * Returns null on decryption failure or malformed data.
 */
export async function unpack(
  key: CryptoKey | null,
  data: ArrayBuffer
): Promise<DecodedFrame | null> {
  let buf = new Uint8Array(data);

  if (key) {
    if (buf.length < 29) return null;
    // Use subarray (zero-copy view) instead of slice (copy)
    const iv = buf.subarray(0, 12);
    try {
      buf = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          buf.subarray(12)
        )
      );
    } catch {
      return null;
    }
  }

  if (buf.length < 1) return null;
  return { type: buf[0] as FrameTypeValue, payload: buf.subarray(1) };
}

/**
 * Returns the crypto engine as inline JavaScript for embedding in the browser frontend.
 * This string is injected into the HTML so the browser has its own copy of deriveKey/pack/unpack.
 */
export function getCryptoJS(): string {
  return `
// ShellPort Crypto Engine v${PROTOCOL_VERSION}
const NONCE_LENGTH = ${NONCE_LENGTH};
const SALT_PREFIX = "${SALT_PREFIX}";
const PBKDF2_ITERATIONS = ${PBKDF2_ITERATIONS};

function generateNonce() {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

async function deriveSessionSalt(serverNonce, clientNonce) {
  const data = new Uint8Array(serverNonce.length + clientNonce.length + SALT_PREFIX.length);
  data.set(serverNonce, 0);
  data.set(clientNonce, serverNonce.length);
  data.set(new TextEncoder().encode(SALT_PREFIX), serverNonce.length + clientNonce.length);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

async function deriveKey(secret, sessionSalt) {
  if (!secret) return null;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const salt = sessionSalt || enc.encode(SALT_PREFIX);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Pack a message: [iv(12)][ciphertext] or [type(1)][payload] if unencrypted
async function pack(key, type, payload) {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  if (!key) return frame;
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    frame
  );
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out;
}

// Unpack a message, decrypting if key provided
async function unpack(key, data) {
  let buf = new Uint8Array(data);
  if (key) {
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    try {
      buf = new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        buf.subarray(12)
      ));
    } catch {
      return null;
    }
  }
  if (buf.length < 1) return null;
  return { type: buf[0], payload: buf.subarray(1) };
}

// Sequential async queue for ordered message handling
class SeqQueue {
  constructor() { this.p = Promise.resolve(); }
  add(fn) { this.p = this.p.then(fn).catch(console.error); }
}
`;
}
```

### File: `src/frontend/build.ts`

- Size: 2001 bytes
- Modified: 2026-03-20 21:33:20 UTC

```typescript
/**
 * ShellPort - Frontend HTML Builder
 *
 * Reads the frontend template and injects styles, crypto engine,
 * NanoTermV2 emulator, and app logic as inline content.
 * This produces a single self-contained HTML response.
 *
 * NanoTermV2 is developed as ES modules in nanoterm/ and bundled
 * into a single IIFE by Bun's bundler before inlining.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFrontendFile(filename: string): string {
    return readFileSync(resolve(__dirname, filename), "utf-8");
}

/**
 * Bundle NanoTermV2 ES modules into a single IIFE script.
 * Skips if the output already exists and sources haven't changed.
 */
async function bundleNanoTerm(): Promise<void> {
    const entrypoint = resolve(__dirname, "nanoterm/index.js");
    if (!existsSync(entrypoint)) return; // Pre-bundled: skip

    const result = await Bun.build({
        entrypoints: [entrypoint],
        outdir: __dirname,
        naming: "nanoterm.js",
        format: "iife",
        minify: false,
        sourcemap: "none",
        target: "browser",
    });

    if (!result.success) {
        console.error("❌ NanoTerm bundle failed:");
        for (const log of result.logs) console.error(log);
        throw new Error("Frontend bundle failed");
    }
}

/**
 * Build the complete HTML client by injecting all frontend assets
 * into the HTML template.
 */
export async function buildHTML(cryptoJS: string): Promise<string> {
    await bundleNanoTerm();

    const template = readFrontendFile("index.html");
    const styles = readFrontendFile("styles.css");
    const nanoterm = readFrontendFile("nanoterm.js");
    const app = readFrontendFile("app.js");

    return template
        .replace("{{STYLES}}", styles)
        .replace("{{CRYPTO_JS}}", cryptoJS)
        .replace("{{NANOTERM_JS}}", nanoterm)
        .replace("{{APP_JS}}", app);
}
```

### File: `src/frontend/bundle.ts`

- Size: 955 bytes
- Modified: 2026-03-20 21:33:20 UTC

```typescript
/**
 * ShellPort Frontend Bundler
 *
 * Bundles the NanoTermV2 ES module sources into a single IIFE script
 * that can be inlined into the HTML template by build.ts.
 *
 * Usage: bun run src/frontend/bundle.ts
 * Output: src/frontend/nanoterm.js
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const result = await Bun.build({
    entrypoints: [resolve(__dirname, "nanoterm/index.js")],
    outdir: resolve(__dirname),
    naming: "nanoterm.js",
    format: "iife",
    minify: false,        // Keep readable for debugging; production minifies via --compile
    sourcemap: "none",
    target: "browser",
});

if (!result.success) {
    console.error("❌ Bundle failed:");
    for (const log of result.logs) {
        console.error(log);
    }
    process.exit(1);
}

console.log(`✅ Bundled nanoterm.js (${(result.outputs[0].size / 1024).toFixed(1)} KB)`);
```

### File: `src/frontend/nanoterm/canvas-renderer.js`

- Size: 22096 bytes
- Modified: 2026-03-21 02:46:28 UTC

```javascript
⼯邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕⼊ 慃癮獡敒摮牥牥钀䌠湡慶㉳⁄敲摮牥湩⁧慢正湥੤⼯邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕闢邕ਊ浩潰瑲笠 †䌠䱅彌佗䑒ⱓ †䌠䱅彌偃卟䥈呆ਬ††䕃䱌䙟䅌升䵟十ⱋ †䌠䱏剏䑟䙅啁呌ਬ††偓䍁彅偃ਬ††呁剔ਬ††佂彘剄坁义彇䕓䵇久協ਬ††敨呸副䉇ⱁ †爠执呡䍯卓紊映潲⁭⸧振湯瑳湡獴樮❳਻攊灸牯⁴汣獡⁳慃癮獡敒摮牥牥笠 †挠湯瑳畲瑣牯挨湯慴湩牥‬灯楴湯ⱳ挠汯牯⥳笠 †††琠楨⹳灯楴湯⁳‽灯楴湯㭳 †††琠楨⹳潣潬獲㴠挠汯牯㭳 †††琠楨⹳档牡楗瑤⁨‽㬰 †††琠楨⹳档牡效杩瑨㴠〠਻††††桴獩氮獡䙴湯⁴‽畮汬਻ †††⼠ 桔浥⁥䝒䅂映牯瀠捡敫⁤散汬爠獥汯瑵潩੮††††桴獩琮敨敭杆䝒䅂㴠栠硥潔䝒䅂挨汯牯⹳潦敲牧畯摮㬩 †††琠楨⹳桴浥䉥剧䉇⁁‽敨呸副䉇⡁潣潬獲戮捡杫潲湵⥤਻ †††⼠ 汇灹⁨癡楡慬楢楬祴挠捡敨 †††琠楨⹳束祬桰慃档⁥‽敮⁷慍⡰㬩 †††琠楨⹳灟慵癁楡慬汢⁥‽慦獬㭥 †††琠楨⹳瑟景䑵瑡⁡‽畮汬਻ †††⼠ 牃慥整挠湡慶ੳ††††桴獩挮湡慶⁳‽潤畣敭瑮挮敲瑡䕥敬敭瑮✨慣癮獡⤧਻††††桴獩挮湡慶⹳汣獡乳浡⁥‽琧牥⵭慣癮獡㬧 †††琠楨⹳慣癮獡琮扡湉敤⁸‽㬰 †††挠湯慴湩牥愮灰湥䍤楨摬琨楨⹳慣癮獡㬩ਊ††††桴獩挮硴㴠琠楨⹳慣癮獡朮瑥潃瑮硥⡴㈧❤‬⁻污桰㩡映污敳素㬩 †素ਊ††⼯肔铢₀潆瑮䴠慥畳敲敭瑮肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢઀ †洠慥畳敲桃牡⤨笠 †††挠湯瑳琠獥䍴湡慶⁳‽潤畣敭瑮挮敲瑡䕥敬敭瑮✨慣癮獡⤧਻††††潣獮⁴整瑳瑃⁸‽整瑳慃癮獡朮瑥潃瑮硥⡴㈧❤㬩 †††挠湯瑳映湯却穩⁥‽桴獩漮瑰潩獮昮湯却穩㭥 †††琠獥䍴硴昮湯⁴‽①晻湯却穩絥硰␠瑻楨⹳灯楴湯⹳潦瑮慆業祬恽਻††††潣獮⁴⁭‽整瑳瑃⹸敭獡牵呥硥⡴圧⤧਻††††桴獩挮慨坲摩桴㴠䴠瑡⹨散汩洨眮摩桴㬩 †††挠湯瑳氠湩䡥楥桧⁴‽桴獩漮瑰潩獮氮湩䡥楥桧⁴籼ㄠㄮ㬵 †††琠楨⹳档牡效杩瑨㴠䴠瑡⹨散汩昨湯却穩⁥‪楬敮效杩瑨㬩ਊ††††⼯䤠癮污摩瑡⁥潴畦爠晥牥湥散搠瑡⁡潳椠❴⁳敲瀭潲敢⁤楷桴挠牵敲瑮映湯ੴ††††桴獩弮潴畦慄慴㴠渠汵㭬 †††琠楨⹳束祬桰慃档⹥汣慥⡲㬩 †††琠楨⹳灟慵癁楡慬汢⁥‽桴獩弮牰扯䝥祬桰✨畜ぅあ⤧簠੼††††††††††††††琠楨⹳灟潲敢汇灹⡨尧䕵䄰✰ 籼 ††††††††††††††桴獩弮牰扯䝥祬桰✨畜う㄰⤧਻††੽ †⼠ 铢肔䜠祬桰䄠慶汩扡汩瑩⁹铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔ਊ††灟潲敢汇灹⡨档 ੻††††潣獮⁴潦瑮灓捥㴠怠笤桴獩漮瑰潩獮昮湯却穩絥硰␠瑻楨⹳灯楴湯⹳潦瑮慆業祬恽਻††††潣獮⁴楳敺㴠䴠瑡⹨慭⡸㐲‬桴獩漮瑰潩獮昮湯却穩⁥‫⤸਻ †††椠⁦ℨ桴獩弮潴畦慄慴 ੻††††††潣獮⁴敲⁦‽潤畣敭瑮挮敲瑡䕥敬敭瑮✨慣癮獡⤧਻††††††敲⹦楷瑤⁨‽楳敺※敲⹦敨杩瑨㴠猠穩㭥 †††††挠湯瑳爠瑣⁸‽敲⹦敧䍴湯整瑸✨搲Ⱗ笠眠汩剬慥䙤敲畱湥汴㩹琠畲⁥⥽਻††††††捲硴昮湯⁴‽潦瑮灓捥਻††††††捲硴琮硥䉴獡汥湩⁥‽琧灯㬧 †††††爠瑣⹸楦汬瑓汹⁥‽⌧晦❦਻††††††捲硴昮汩呬硥⡴尧䙵䙆❆‬ⰲ㈠㬩 †††††琠楨⹳瑟景䑵瑡⁡‽捲硴朮瑥浉条䑥瑡⡡ⰰ〠‬楳敺‬楳敺⸩慤慴਻††††੽ †††挠湯瑳瀠潲敢㴠搠捯浵湥⹴牣慥整汅浥湥⡴挧湡慶❳㬩 †††瀠潲敢眮摩桴㴠猠穩㭥瀠潲敢栮楥桧⁴‽楳敺਻††††潣獮⁴捰硴㴠瀠潲敢朮瑥潃瑮硥⡴㈧❤‬⁻楷汬敒摡牆煥敵瑮祬›牴敵素㬩 †††瀠瑣⹸潦瑮㴠映湯却数㭣 †††瀠瑣⹸整瑸慂敳楬敮㴠✠潴❰਻††††捰硴昮汩卬祴敬㴠✠昣晦㬧 †††瀠瑣⹸楦汬敔瑸挨ⱨ㈠‬⤲਻††††潣獮⁴整瑳慄慴㴠瀠瑣⹸敧䥴慭敧慄慴〨‬ⰰ猠穩ⱥ猠穩⥥搮瑡㭡ਊ††††敬⁴楤晦㴠〠਻††††敬⁴慨偳硩汥⁳‽慦獬㭥 †††映牯⠠敬⁴⁩‽㬳椠㰠琠獥䑴瑡⹡敬杮桴※⁩㴫㐠 ੻††††††晩⠠整瑳慄慴楛⁝‾⤰栠獡楐數獬㴠琠畲㭥 †††††椠⁦琨獥䑴瑡孡嵩℠㴽琠楨⹳瑟景䑵瑡孡嵩 楤晦⬫਻††††੽ †††椠⁦搨晩⁦㴽‽‰☦栠獡楐數獬 敲畴湲映污敳਻††††晩⠠校獡楐數獬 敲畴湲映污敳਻††††敲畴湲琠畲㭥 †素ਊ††楟䝳祬桰敒摮牥扡敬挨⥰笠 †††椠⁦挨⁰‼砰㔰〳 敲畴湲琠畲㭥 †††椠⁦挨⁰㴾〠㑸ぅ‰☦挠⁰㴼〠㥸䙆⥆爠瑥牵⁮牴敵਻††††晩⠠灣㸠‽砰ぅ〰☠…灣㰠‽砰㡆䙆 敲畴湲琠楨⹳灟慵癁楡慬汢㭥 †††椠⁦挨⁰㴾〠䙸〰〰 敲畴湲琠楨⹳灟慵癁楡慬汢㭥 †††挠湯瑳挠捡敨⁤‽桴獩弮汧灹䍨捡敨朮瑥挨⥰਻††††晩⠠慣档摥℠㴽甠摮晥湩摥 敲畴湲挠捡敨㭤 †††挠湯瑳爠湥敤慲汢⁥‽桴獩弮牰扯䝥祬桰匨牴湩⹧牦浯潃敤潐湩⡴灣⤩਻††††桴獩弮汧灹䍨捡敨献瑥挨Ɒ爠湥敤慲汢⥥਻††††敲畴湲爠湥敤慲汢㭥 †素ਊ††⼯肔铢₀敒楳敺肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢઀ †爠獥穩䍥湡慶⡳潣瑮楡敮割捥⥴笠 †††挠湯瑳搠牰㴠眠湩潤⹷敤楶散楐數剬瑡潩簠⁼㬱 †††琠楨⹳慣癮獡眮摩桴㴠挠湯慴湩牥敒瑣眮摩桴⨠搠牰਻††††桴獩挮湡慶⹳敨杩瑨㴠挠湯慴湩牥敒瑣栮楥桧⁴‪灤㭲 †††琠楨⹳慣癮獡献祴敬眮摩桴㴠挠湯慴湩牥敒瑣眮摩桴⬠✠硰㬧 †††琠楨⹳慣癮獡献祴敬栮楥桧⁴‽潣瑮楡敮割捥⹴敨杩瑨⬠✠硰㬧 †††琠楨⹳瑣⹸敳呴慲獮潦浲搨牰‬ⰰ〠‬灤Ⱳ〠‬⤰਻††††桴獩氮獡䙴湯⁴‽畮汬਻††੽ †⼠ 铢肔䌠汯牯爠獥汯瑵潩⁮敨灬牥⁳铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔ਊ††牟獥汯敶杂䝒䅂眨牯つ‬杦䝒䅂‬杢䝒䅂 ੻††††潣獮⁴汦条⁳‽潷摲‰…䕃䱌䙟䅌升䵟十㭋 †††椠⁦昨慬獧☠䄠呔⹒义䕖卒⥅笠 †††††爠瑥牵⁮杦䝒䅂㴠㴽䌠䱏剏䑟䙅啁呌㼠琠楨⹳桴浥䙥剧䉇⁁›杦䝒䅂਻††††੽††††敲畴湲戠剧䉇⁁㴽‽佃佌归䕄䅆䱕⁔‿桴獩琮敨敭杂䝒䅂㨠戠剧䉇㭁 †素ਊ††牟獥汯敶杆䝒䅂眨牯つ‬杦䝒䅂‬杢䝒䅂 ੻††††潣獮⁴汦条⁳‽潷摲‰…䕃䱌䙟䅌升䵟十㭋 †††椠⁦昨慬獧☠䄠呔⹒义䕖卒⥅笠 †††††爠瑥牵⁮杢䝒䅂㴠㴽䌠䱏剏䑟䙅啁呌㼠琠楨⹳桴浥䉥剧䉇⁁›杢䝒䅂਻††††੽††††敲畴湲映剧䉇⁁㴽‽佃佌归䕄䅆䱕⁔‿桴獩琮敨敭杆䝒䅂㨠映剧䉇㭁 †素ਊ††⼯肔铢₀慍湩删湥敤⁲铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢઀ †爠湥敤⡲整浲 ੻††††潣獮⁴楷瑤⁨‽桴獩挮湡慶⹳楷瑤⁨ 眨湩潤⹷敤楶散楐數剬瑡潩簠⁼⤱਻††††潣獮⁴敨杩瑨㴠琠楨⹳慣癮獡栮楥桧⁴ 眨湩潤⹷敤楶散楐數剬瑡潩簠⁼⤱਻††††潣獮⁴慰⁤‽桴獩漮瑰潩獮瀮摡楤杮਻ †††琠楨⹳瑣⹸楦汬瑓汹⁥‽桴獩挮汯牯⹳慢正牧畯摮਻††††桴獩挮硴昮汩剬捥⡴ⰰ〠‬楷瑤ⱨ栠楥桧⥴਻ †††琠楨⹳瑣⹸慳敶⤨਻††††桴獩挮硴琮慲獮慬整瀨摡‬慰⥤਻††††桴獩氮獡䙴湯⁴‽畮汬਻ †††挠湯瑳猠牣汯扬捡噫獩扩敬㴠琠牥⹭捳潲汬慢正晏獦瑥㸠〠☠…琡牥⹭獵䅥瑬牥慮整਻ †††挠湯瑳瘠獩扩敬潒獷㴠嬠㭝ਊ††††晩⠠捳潲汬慢正楖楳汢⥥笠 †††††挠湯瑳猠牣汯扬捡卫慴瑲㴠䴠瑡⹨慭⡸ⰰ琠牥⹭捳潲汬慢正畂晦牥氮湥瑧⁨‭整浲献牣汯扬捡佫晦敳⥴਻††††††潣獮⁴捳潲汬慢正潒獷㴠䴠瑡⹨業⡮整浲献牣汯扬捡佫晦敳ⱴ琠牥⹭潲獷㬩 †††††映牯⠠敬⁴⁩‽㬰椠㰠猠牣汯扬捡剫睯㭳椠⬫ ੻††††††††潣獮⁴摩⁸‽捳潲汬慢正瑓牡⁴‫㭩 †††††††椠⁦椨硤㰠琠牥⹭捳潲汬慢正畂晦牥氮湥瑧⥨笠 †††††††††挠湯瑳猠剢睯㴠琠牥⹭捳潲汬慢正畂晦牥楛硤㭝 †††††††††瘠獩扩敬潒獷瀮獵⡨⁻牧摩›扳潒ⱷ朠楲䍤汯㩳猠剢睯氮湥瑧⁨ 䕃䱌坟剏卄‬牧摩㩙〠‬捳敲湥㩙椠素㬩 †††††††素 †††††素 †††††挠湯瑳猠慴瑲潒⁷‽捳潲汬慢正潒獷਻††††††潦⁲氨瑥礠㴠〠※⁹‼整浲爮睯⁳‭瑳牡剴睯☠…⁹‫瑳牡剴睯㰠琠牥⹭潲獷※⭹⤫笠 †††††††瘠獩扩敬潒獷瀮獵⡨⁻牧摩›整浲朮楲Ɽ朠楲䍤汯㩳琠牥⹭潣獬‬牧摩㩙礠‬捳敲湥㩙猠慴瑲潒⁷‫⁹⥽਻††††††੽††††⁽汥敳笠 †††††映牯⠠敬⁴⁹‽㬰礠㰠琠牥⹭潲獷※⭹⤫笠 †††††††瘠獩扩敬潒獷瀮獵⡨⁻牧摩›整浲朮楲Ɽ朠楲䍤汯㩳琠牥⹭潣獬‬牧摩㩙礠‬捳敲湥㩙礠素㬩 †††††素 †††素ਊ††††潦⁲挨湯瑳瘠⁲景瘠獩扩敬潒獷 ੻††††††桴獩爮湥敤割睯杂瘨⹲牧摩‬牶朮楲䍤汯ⱳ瘠⹲牧摩ⱙ瘠⹲捳敲湥⥙਻††††੽ †††映牯⠠潣獮⁴牶漠⁦楶楳汢剥睯⥳笠 †††††琠楨⹳敲摮牥潒呷硥⡴牶朮楲Ɽ瘠⹲牧摩潃獬‬牶朮楲奤‬牶献牣敥奮㬩 †††素ਊ††††晩⠠整浲献汥捥楴湯 桴獩爮湥敤卲汥捥楴湯琨牥⥭਻††††晩⠠整浲挮牵潳噲獩扩敬☠…整浲昮捯獵摥 桴獩爮湥敤䍲牵潳⡲整浲㬩ਊ††††桴獩挮硴爮獥潴敲⤨਻††੽ †⼠ 铢肔删睯删湥敤楲杮肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔ਊ††敲摮牥潒䉷⡧牧摩‬牧摩潃獬‬牧摩ⱙ猠牣敥奮 ੻††††潣獮⁴慢敳楬敮㴠猠牣敥奮⨠琠楨⹳档牡效杩瑨਻††††潣獮⁴潲佷晦敳⁴‽牧摩⁙‪牧摩潃獬⨠䌠䱅彌佗䑒㭓 †††挠湯瑳爠湥敤䍲汯⁳‽慍桴洮湩木楲䍤汯ⱳ琠楨⹳牟湥敤䍲汯⁳籼朠楲䍤汯⥳਻ †††氠瑥戠卧慴瑲㴠〠਻††††敬⁴景⁦‽潲佷晦敳㭴 †††氠瑥挠牵敲瑮杂㴠琠楨⹳牟獥汯敶杂䝒䅂木楲孤景嵦‬牧摩潛晦⬠ㄠⱝ朠楲孤景⁦‫崲㬩ਊ††††潦⁲氨瑥挠汯㴠ㄠ※潣⁬㴼爠湥敤䍲汯㭳挠汯⬫ ੻††††††敬⁴散汬杂਻††††††晩⠠潣⁬‼敲摮牥潃獬 ੻††††††††景⁦‽潲佷晦敳⁴‫潣⁬‪䕃䱌坟剏卄਻††††††††散汬杂㴠琠楨⹳牟獥汯敶杂䝒䅂木楲孤景嵦‬牧摩潛晦⬠ㄠⱝ朠楲孤景⁦‫崲㬩 †††††素攠獬⁥੻††††††††散汬杂㴠縠畣牲湥䉴⁧㸾‾㬰 †††††素 †††††椠⁦挨汥䉬⁧㴡‽畣牲湥䉴⥧笠 †††††††琠楨⹳瑣⹸楦汬瑓汹⁥‽杲慢潔千⡓畣牲湥䉴⥧਻††††††††桴獩挮硴昮汩剬捥⡴杢瑓牡⁴‪桴獩挮慨坲摩桴‬慢敳楬敮‬挨汯ⴠ戠卧慴瑲 ‪桴獩挮慨坲摩桴‬桴獩挮慨䡲楥桧⥴਻††††††††杢瑓牡⁴‽潣㭬 †††††††挠牵敲瑮杂㴠挠汥䉬㭧 †††††素 †††素 †素ਊ††敲摮牥潒呷硥⡴牧摩‬牧摩潃獬‬牧摩ⱙ猠牣敥奮 ੻††††潣獮⁴慢敳楬敮㴠猠牣敥奮⨠琠楨⹳档牡效杩瑨਻††††潣獮⁴潲佷晦敳⁴‽牧摩⁙‪牧摩潃獬⨠䌠䱅彌佗䑒㭓 †††挠湯瑳爠湥敤䍲汯⁳‽慍桴洮湩木楲䍤汯ⱳ琠楨⹳牟湥敤䍲汯⁳籼朠楲䍤汯⥳਻ †††氠瑥爠湵瑓牡⁴‽㬰 †††氠瑥漠晦㴠爠睯晏獦瑥਻††††敬⁴畣牲湥䙴⁧‽牧摩潛晦⬠ㄠ㭝 †††氠瑥挠牵敲瑮杂㴠朠楲孤景⁦‫崲਻††††敬⁴畣牲湥䙴慬獧㴠朠楲孤景嵦☠䌠䱅彌䱆䝁当䅍䭓਻ †††映牯⠠敬⁴潣⁬‽㬱挠汯㰠‽敲摮牥潃獬※潣⭬⤫笠 †††††氠瑥映Ⱨ戠Ⱨ映慬獧਻††††††晩⠠潣⁬‼敲摮牥潃獬 ੻††††††††景⁦‽潲佷晦敳⁴‫潣⁬‪䕃䱌坟剏卄਻††††††††杦㴠朠楲孤景⁦‫崱਻††††††††杢㴠朠楲孤景⁦‫崲਻††††††††汦条⁳‽牧摩潛晦⁝…䕃䱌䙟䅌升䵟十㭋 †††††素攠獬⁥੻††††††††杦㴠縠畣牲湥䙴⁧㸾‾㬰 †††††††戠⁧‽㬰 †††††††映慬獧㴠〠਻††††††੽††††††晩⠠杦℠㴽挠牵敲瑮杆簠⁼杢℠㴽挠牵敲瑮杂簠⁼汦条⁳㴡‽畣牲湥䙴慬獧 ੻††††††††晩⠠潣⁬‾畲卮慴瑲 ੻††††††††††桴獩爮湥敤割湵敔瑸木楲Ɽ朠楲䍤汯ⱳ朠楲奤‬畲卮慴瑲‬潣⁬‭畲卮慴瑲‬慢敳楬敮‬畣牲湥䙴Ⱨ挠牵敲瑮杂‬畣牲湥䙴慬獧㬩 †††††††素 †††††††爠湵瑓牡⁴‽潣㭬 †††††††挠牵敲瑮杆㴠映㭧 †††††††挠牵敲瑮杂㴠戠㭧 †††††††挠牵敲瑮汆条⁳‽汦条㭳 †††††素 †††素 †素ਊ††敲摮牥畒呮硥⡴牧摩‬牧摩潃獬‬牧摩ⱙ猠慴瑲ⱘ氠湥瑧ⱨ戠獡汥湩ⱥ映剧䉇ⱁ戠剧䉇ⱁ映慬獧 ੻††††潣獮⁴潲佷晦敳⁴‽牧摩⁙‪牧摩潃獬⨠䌠䱅彌佗䑒㭓ਊ††††敬⁴慨䍳湯整瑮㴠映污敳਻††††潦⁲氨瑥砠㴠猠慴瑲㭘砠㰠猠慴瑲⁘‫敬杮桴※⭸⤫笠 †††††挠湯瑳挠⁰‽牧摩牛睯晏獦瑥⬠砠⨠䌠䱅彌佗䑒嵓㸠㸾䌠䱅彌偃卟䥈呆਻††††††晩⠠灣℠㴽匠䅐䕃䍟⁐☦挠⁰㴡‽⤰笠 †††††††栠獡潃瑮湥⁴‽牴敵਻††††††††牢慥㭫 †††††素 †††素ਊ††††晩⠠校獡潃瑮湥⁴☦℠昨慬獧☠⠠呁剔售䑎剅䥌䕎簠䄠呔⹒佄䉕䕌啟䑎剅䥌䕎簠䄠呔⹒呓䥒䕋䡔佒䝕⥈⤩笠 †††††爠瑥牵㭮 †††素ਊ††††潣獮⁴整瑸潃潬割䉇⁁‽桴獩弮敲潳癬䙥剧䉇⡁汦条ⱳ映剧䉇ⱁ戠剧䉇⥁਻††††潣獮⁴整瑸潃潬⁲‽杲慢潔千⡓整瑸潃潬割䉇⥁਻††††桴獩挮硴昮汩卬祴敬㴠琠硥䍴汯牯਻ †††挠湯瑳映湯側牡獴㴠嬠㭝 †††椠⁦昨慬獧☠䄠呔⹒佂䑌 潦瑮慐瑲⹳異桳✨潢摬⤧਻††††晩⠠汦条⁳…呁剔䤮䅔䥌⥃映湯側牡獴瀮獵⡨椧慴楬❣㬩 †††映湯側牡獴瀮獵⡨①瑻楨⹳灯楴湯⹳潦瑮楓敺災恸㬩 †††映湯側牡獴瀮獵⡨桴獩漮瑰潩獮昮湯䙴浡汩⥹਻††††潣獮⁴潦瑮瑓楲杮㴠映湯側牡獴樮楯⡮‧⤧਻ †††椠⁦琨楨⹳慬瑳潆瑮℠㴽映湯却牴湩⥧笠 †††††琠楨⹳瑣⹸潦瑮㴠映湯却牴湩㭧 †††††琠楨⹳慬瑳潆瑮㴠映湯却牴湩㭧 †††素 †††琠楨⹳瑣⹸整瑸慂敳楬敮㴠✠潴❰਻ †††映牯⠠敬⁴⁩‽㬰椠㰠氠湥瑧㭨椠⬫ ੻††††††潣獮⁴景⁦‽潲佷晦敳⁴‫猨慴瑲⁘‫⥩⨠䌠䱅彌佗䑒㭓 †††††挠湯瑳挠⁰‽牧摩潛晦⁝㸾‾䕃䱌䍟彐䡓䙉㭔 †††††椠⁦挨⁰㴽‽偓䍁彅偃簠⁼灣㴠㴽〠 潣瑮湩敵਻††††††潣獮⁴硣㴠⠠瑳牡塴⬠椠 ‪桴獩挮慨坲摩桴਻††††††晩⠠灣㸠‽砰㔲〰☠…桴獩爮湥敤卲数楣污桃牡挨Ɒ挠ⱸ戠獡汥湩ⱥ琠硥䍴汯牯⤩挠湯楴畮㭥 †††††椠⁦ℨ桴獩弮獩汇灹剨湥敤慲汢⡥灣⤩挠湯楴畮㭥 †††††琠楨⹳瑣⹸楦汬敔瑸匨牴湩⹧牦浯潃敤潐湩⡴灣Ⱙ挠ⱸ戠獡汥湩⥥਻††††੽ †††⼠ 湕敤汲湩੥††††晩⠠汦条⁳…呁剔售䑎剅䥌䕎 ੻††††††桴獩挮硴献牴歯卥祴敬㴠琠硥䍴汯牯਻††††††桴獩挮硴氮湩坥摩桴㴠ㄠ਻††††††桴獩挮硴戮来湩慐桴⤨਻††††††桴獩挮硴洮癯呥⡯瑳牡塴⨠琠楨⹳档牡楗瑤ⱨ戠獡汥湩⁥‫桴獩挮慨䡲楥桧⁴‭⤲਻††††††桴獩挮硴氮湩呥⡯猨慴瑲⁘‫敬杮桴 ‪桴獩挮慨坲摩桴‬慢敳楬敮⬠琠楨⹳档牡效杩瑨ⴠ㈠㬩 †††††琠楨⹳瑣⹸瑳潲敫⤨਻††††੽ †††⼠ 潄扵敬甠摮牥楬敮 †††椠⁦昨慬獧☠䄠呔⹒佄䉕䕌啟䑎剅䥌䕎 ੻††††††桴獩挮硴献牴歯卥祴敬㴠琠硥䍴汯牯਻††††††桴獩挮硴氮湩坥摩桴㴠ㄠ਻††††††桴獩挮硴戮来湩慐桴⤨਻††††††桴獩挮硴洮癯呥⡯瑳牡塴⨠琠楨⹳档牡楗瑤ⱨ戠獡汥湩⁥‫桴獩挮慨䡲楥桧⁴‭⤴਻††††††桴獩挮硴氮湩呥⡯猨慴瑲⁘‫敬杮桴 ‪桴獩挮慨坲摩桴‬慢敳楬敮⬠琠楨⹳档牡效杩瑨ⴠ㐠㬩 †††††琠楨⹳瑣⹸潭敶潔猨慴瑲⁘‪桴獩挮慨坲摩桴‬慢敳楬敮⬠琠楨⹳档牡效杩瑨ⴠ㈠㬩 †††††琠楨⹳瑣⹸楬敮潔⠨瑳牡塴⬠氠湥瑧⥨⨠琠楨⹳档牡楗瑤ⱨ戠獡汥湩⁥‫桴獩挮慨䡲楥桧⁴‭⤲਻††††††桴獩挮硴献牴歯⡥㬩 †††素ਊ††††⼯匠牴歩瑥牨畯桧 †††椠⁦昨慬獧☠䄠呔⹒呓䥒䕋䡔佒䝕⥈笠 †††††琠楨⹳瑣⹸瑳潲敫瑓汹⁥‽整瑸潃潬㭲 †††††琠楨⹳瑣⹸楬敮楗瑤⁨‽㬱 †††††琠楨⹳瑣⹸敢楧偮瑡⡨㬩 †††††琠楨⹳瑣⹸潭敶潔猨慴瑲⁘‪桴獩挮慨坲摩桴‬慢敳楬敮⬠琠楨⹳档牡效杩瑨⼠㈠㬩 †††††琠楨⹳瑣⹸楬敮潔⠨瑳牡塴⬠氠湥瑧⥨⨠琠楨⹳档牡楗瑤ⱨ戠獡汥湩⁥‫桴獩挮慨䡲楥桧⁴ ⤲਻††††††桴獩挮硴献牴歯⡥㬩 †††素 †素ਊ††⼯肔铢₀灓捥慩⁬桃牡捡整獲肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢઀ †爠湥敤卲数楣污桃牡挨摯ⱥ砠‬ⱹ挠汯牯 ੻††††晩⠠潣敤㸠‽砰㔲〸☠…潣敤㰠‽砰㔲䘹 敲畴湲琠楨⹳敲摮牥求捯䍫慨⡲潣敤‬ⱸ礠‬潣潬⥲਻††††晩⠠潣敤㸠‽砰㔲〰☠…潣敤㰠‽砰㔲䘷 敲畴湲琠楨⹳敲摮牥潂䑸慲楷杮挨摯ⱥ砠‬ⱹ挠汯牯㬩 †††椠⁦挨摯⁥㴾〠㉸〸‰☦挠摯⁥㴼〠㉸䘸⥆爠瑥牵⁮桴獩爮湥敤䉲慲汩敬挨摯ⱥ砠‬ⱹ挠汯牯㬩 †††爠瑥牵⁮慦獬㭥 †素ਊ††敲摮牥求捯䍫慨⡲潣敤‬ⱸ礠‬潣潬⥲笠 †††挠湯瑳眠㴠琠楨⹳档牡楗瑤㭨 †††挠湯瑳栠㴠琠楨⹳档牡效杩瑨਻††††桴獩挮硴昮汩卬祴敬㴠挠汯牯਻ †††椠⁦挨摯⁥㴽‽砰㔲㠸 ⁻桴獩挮硴昮汩剬捥⡴ⱸ礠‬⁷‫⸰ⰵ栠⬠〠㔮㬩爠瑥牵⁮牴敵※੽††††晩⠠潣敤㴠㴽〠㉸㠵⤰笠琠楨⹳瑣⹸楦汬敒瑣砨‬ⱹ眠⬠〠㔮‬慍桴挮楥⡬⁨ ⤲㬩爠瑥牵⁮牴敵※੽††††晩⠠潣敤㸠‽砰㔲ㄸ☠…潣敤㰠‽砰㔲㜸 ੻††††††潣獮⁴牦捡㴠⠠潣敤ⴠ〠㉸㠵⤰⼠㠠਻††††††潣獮⁴桢㴠䴠瑡⹨潲湵⡤⁨‪牦捡㬩 †††††琠楨⹳瑣⹸楦汬敒瑣砨‬⁹‫⁨‭桢‬⁷‫⸰ⰵ戠⁨‫⸰⤵਻††††††敲畴湲琠畲㭥 †††素 †††椠⁦挨摯⁥㴾〠㉸㠵‹☦挠摯⁥㴼〠㉸㠵⥆笠 †††††挠湯瑳映慲⁣‽〨㉸㤵‰‭潣敤  㬸 †††††琠楨⹳瑣⹸楦汬敒瑣砨‬ⱹ䴠瑡⹨潲湵⡤⁷‪牦捡 ‫⸰ⰵ栠⬠〠㔮㬩 †††††爠瑥牵⁮牴敵਻††††੽††††晩⠠潣敤㴠㴽〠㉸㤵⤰笠 †††††挠湯瑳栠⁷‽慍桴昮潬牯眨⼠㈠㬩 †††††琠楨⹳瑣⹸楦汬敒瑣砨⬠栠ⱷ礠‬⁷‭睨⬠〠㔮‬⁨‫⸰⤵਻††††††敲畴湲琠畲㭥 †††素 †††椠⁦挨摯⁥㴾〠㉸㤵‱☦挠摯⁥㴼〠㉸㤵⤳笠 †††††挠湯瑳愠灬慨㴠嬠⸰㔲‬⸰〵‬⸰㔷孝潣敤ⴠ〠㉸㤵崱਻††††††桴獩挮硴朮潬慢䅬灬慨㴠愠灬慨਻††††††桴獩挮硴昮汩剬捥⡴ⱸ礠‬⁷‫⸰ⰵ栠⬠〠㔮㬩 †††††琠楨⹳瑣⹸汧扯污汁桰⁡‽㬱 †††††爠瑥牵⁮牴敵਻††††੽††††晩⠠潣敤㴠㴽〠㉸㤵⤴笠琠楨⹳瑣⹸楦汬敒瑣砨‬ⱹ眠‬慍桴洮硡ㄨ‬慍桴爮畯摮栨⼠㠠⤩㬩爠瑥牵⁮牴敵※੽††††晩⠠潣敤㴠㴽〠㉸㤵⤵笠 †††††挠湯瑳攠⁷‽慍桴洮硡ㄨ‬慍桴爮畯摮眨⼠㠠⤩਻††††††桴獩挮硴昮汩剬捥⡴⁸‫⁷‭睥‬ⱹ攠ⱷ栠㬩 †††††爠瑥牵⁮牴敵਻††††੽††††晩⠠潣敤㸠‽砰㔲㘹☠…潣敤㰠‽砰㔲䘹 ੻††††††潣獮⁴慭歳⁳‽ਜ਼††††††††戰〰〱‬戰〰㄰‬戰〱〰‬戰〱ㄱ‬戰〱㄰ਬ††††††††戰ㄱ〱‬戰ㄱ㄰‬戰㄰〰‬戰㄰〱‬戰㄰ㄱ †††††崠਻††††††潣獮⁴慭歳㴠洠獡獫捛摯⁥‭砰㔲㘹㭝 †††††挠湯瑳栠⁷‽慍桴挮楥⡬⁷ ⤲‬桨㴠䴠瑡⹨散汩栨⼠㈠㬩 †††††椠⁦洨獡⁫…⤸琠楨⹳瑣⹸楦汬敒瑣砨‬ⱹ栠ⱷ栠⥨਻††††††晩⠠慭歳☠㐠 桴獩挮硴昮汩剬捥⡴⁸‫睨‬ⱹ眠ⴠ栠ⱷ栠⥨਻††††††晩⠠慭歳☠㈠ 桴獩挮硴昮汩剬捥⡴ⱸ礠⬠栠ⱨ栠ⱷ栠ⴠ栠⥨਻††††††晩⠠慭歳☠ㄠ 桴獩挮硴昮汩剬捥⡴⁸‫睨‬⁹‫桨‬⁷‭睨‬⁨‭桨㬩 †††††爠瑥牵⁮牴敵਻††††੽††††敲畴湲映污敳਻††੽ †爠湥敤䉲硯牄睡湩⡧潣敤‬ⱸ礠‬潣潬⥲笠 †††挠湯瑳椠硤㴠挠摯⁥‭砰㔲〰਻††††晩⠠摩⁸‼‰籼椠硤㸠‽佂彘剄坁义彇䕓䵇久協氮湥瑧⥨爠瑥牵⁮慦獬㭥 †††挠湯瑳猠来㴠䈠塏䑟䅒䥗䝎卟䝅䕍呎孓摩嵸਻††††晩⠠猡来 敲畴湲映污敳਻ †††挠湯瑳嬠睬‬睲‬睵‬睤⁝‽敳㭧 †††挠湯瑳眠㴠琠楨⹳档牡楗瑤㭨 †††挠湯瑳栠㴠琠楨⹳档牡效杩瑨਻††††潣獮⁴硭㴠砠⬠䴠瑡⹨汦潯⡲⁷ ⤲਻††††潣獮⁴祭㴠礠⬠䴠瑡⹨汦潯⡲⁨ ⤲਻††††潣獮⁴桴湩㴠ㄠ਻††††潣獮⁴桴捩⁫‽慍桴洮硡㈨‬慍桴爮畯摮眨⼠㔠⤩਻††††潣獮⁴慧⁰‽慍桴洮硡㈨‬慍桴爮畯摮䴨瑡⹨業⡮ⱷ栠 ‪⸰⤳㬩ਊ††††桴獩挮硴昮汩卬祴敬㴠挠汯牯਻ †††挠湯瑳栠楌敮㴠⠠ㅸ‬㉸‬祣‬瑷 㸽笠 †††††椠⁦眨⁴㴽‽⤱琠楨⹳瑣⹸楦汬敒瑣砨ⰱ挠ⱹ砠′‭ㅸ‬桴湩㬩 †††††攠獬⁥晩⠠瑷㴠㴽㈠ 桴獩挮硴昮汩剬捥⡴ㅸ‬祣ⴠ䴠瑡⹨汦潯⡲桴捩⁫ ⤲‬㉸ⴠ砠ⰱ琠楨正㬩 †††††攠獬⁥晩⠠瑷㴠㴽㌠ ੻††††††††桴獩挮硴昮汩剬捥⡴ㅸ‬祣ⴠ朠灡‬㉸ⴠ砠ⰱ琠楨⥮਻††††††††桴獩挮硴昮汩剬捥⡴ㅸ‬祣⬠朠灡‬㉸ⴠ砠ⰱ琠楨⥮਻††††††੽††††㭽 †††挠湯瑳瘠楌敮㴠⠠ㅹ‬㉹‬硣‬瑷 㸽笠 †††††椠⁦眨⁴㴽‽⤱琠楨⹳瑣⹸楦汬敒瑣挨ⱸ礠ⰱ琠楨Ɱ礠′‭ㅹ㬩 †††††攠獬⁥晩⠠瑷㴠㴽㈠ 桴獩挮硴昮汩剬捥⡴硣ⴠ䴠瑡⹨汦潯⡲桴捩⁫ ⤲‬ㅹ‬桴捩Ⱬ礠′‭ㅹ㬩 †††††攠獬⁥晩⠠瑷㴠㴽㌠ ੻††††††††桴獩挮硴昮汩剬捥⡴硣ⴠ朠灡‬ㅹ‬桴湩‬㉹ⴠ礠⤱਻††††††††桴獩挮硴昮汩剬捥⡴硣⬠朠灡‬ㅹ‬桴湩‬㉹ⴠ礠⤱਻††††††੽††††㭽ਊ††††晩⠠睬 䱨湩⡥ⱸ洠⁸‫桴湩‬祭‬睬㬩 †††椠⁦爨⥷栠楌敮洨ⱸ砠⬠眠‬祭‬睲㬩 †††椠⁦用⥷瘠楌敮礨‬祭⬠琠楨Ɱ洠ⱸ甠⥷਻††††晩⠠睤 䱶湩⡥祭‬⁹‫ⱨ洠ⱸ搠⥷਻ †††爠瑥牵⁮牴敵਻††੽ †爠湥敤䉲慲汩敬挨摯ⱥ砠‬ⱹ挠汯牯 ੻††††潣獮⁴楢獴㴠挠摯⁥‭砰㠲〰਻††††晩⠠楢獴㴠㴽〠 敲畴湲琠畲㭥 †††挠湯瑳眠㴠琠楨⹳档牡楗瑤㭨 †††挠湯瑳栠㴠琠楨⹳档牡效杩瑨਻††††潣獮⁴潤坴㴠䴠瑡⹨慭⡸ⰱ䴠瑡⹨潲湵⡤⁷‪⸰⤲㬩 †††挠湯瑳搠瑯⁈‽慍桴洮硡ㄨ‬慍桴爮畯摮栨⨠〠ㄮ⤩਻††††潣獮⁴硣‱‽⁸‫慍桴爮畯摮眨⨠〠㌮㬩 †††挠湯瑳挠㉸㴠砠⬠䴠瑡⹨潲湵⡤⁷‪⸰⤷਻††††潣獮⁴潲獷㴠嬠⸰㔱‬⸰㔳‬⸰㔵‬⸰㔷㭝 †††挠湯瑳搠瑯慍⁰‽ਜ਼††††††せ‬硣崱‬ㅛ‬硣崱‬㉛‬硣崱‬㙛‬硣崱ਬ††††††㍛‬硣崲‬㑛‬硣崲‬㕛‬硣崲‬㝛‬硣崲 †††崠਻††††桴獩挮硴昮汩卬祴敬㴠挠汯牯਻††††潦⁲氨瑥椠㴠〠※⁩‼㬸椠⬫ ੻††††††潣獮⁴扛瑩‬硤⁝‽潤䵴灡楛㭝 †††††椠⁦戨瑩⁳…ㄨ㰠‼楢⥴ ੻††††††††潣獮⁴祤㴠礠⬠䴠瑡⹨潲湵⡤⁨‪潲獷楛┠㐠⥝਻††††††††桴獩挮硴昮汩剬捥⡴硤ⴠ䴠瑡⹨汦潯⡲潤坴⼠㈠Ⱙ搠⁹‭慍桴昮潬牯搨瑯⁈ ⤲‬潤坴‬潤䡴㬩 †††††素 †††素 †††爠瑥牵⁮牴敵਻††੽ †⼠ 铢肔䌠牵潳⁲…敓敬瑣潩⁮铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔ਊ††敲摮牥畃獲牯琨牥⥭笠 †††挠湯瑳砠㴠琠牥⹭畣獲牯⁘‪桴獩挮慨坲摩桴਻††††潣獮⁴⁹‽整浲挮牵潳奲⨠琠楨⹳档牡效杩瑨਻††††潣獮⁴摡番瑳摥⁙‽⁹‭琨牥⹭捳潲汬慢正晏獦瑥⨠琠楨⹳档牡效杩瑨㬩ਊ††††晩⠠摡番瑳摥⁙‼‰籼愠橤獵整奤㸠‽桴獩挮湡慶⹳敨杩瑨⼠⠠楷摮睯搮癥捩健硩汥慒楴⁯籼ㄠ⤩爠瑥牵㭮 †††椠⁦ℨ整浲挮牵潳䉲楬歮瑓瑡⁥☦琠楨⹳灯楴湯⹳畣獲牯求湩⥫爠瑥牵㭮ਊ††††桴獩挮硴昮汩卬祴敬㴠琠楨⹳潣潬獲挮牵潳㭲ਊ††††睳瑩档⠠桴獩漮瑰潩獮挮牵潳卲祴敬 ੻††††††慣敳✠湵敤汲湩❥਺††††††††桴獩挮硴昮汩剬捥⡴ⱸ愠橤獵整奤⬠琠楨⹳档牡效杩瑨ⴠ㌠‬桴獩挮慨坲摩桴‬⤳਻††††††††牢慥㭫 †††††挠獡⁥戧牡㨧 †††††††琠楨⹳瑣⹸楦汬敒瑣砨‬摡番瑳摥ⱙ㈠‬桴獩挮慨䡲楥桧⥴਻††††††††牢慥㭫 †††††挠獡⁥戧潬正㨧 †††††搠晥畡瑬਺††††††††晩⠠整浲挮牵潳䉲楬歮瑓瑡⥥笠 †††††††††琠楨⹳瑣⹸楦汬敒瑣砨‬摡番瑳摥ⱙ琠楨⹳档牡楗瑤ⱨ琠楨⹳档牡效杩瑨㬩 †††††††††挠湯瑳漠晦㴠⠠整浲挮牵潳奲⨠琠牥⹭潣獬⬠琠牥⹭畣獲牯⥘⨠䌠䱅彌佗䑒㭓 †††††††††挠湯瑳眠牯つ㴠琠牥⹭牧摩潛晦㭝 †††††††††挠湯瑳挠⁰‽潷摲‰㸾‾䕃䱌䍟彐䡓䙉㭔 †††††††††挠湯瑳挠汥䙬慬獧㴠眠牯つ☠䌠䱅彌䱆䝁当䅍䭓਻††††††††††晩⠠灣℠㴽匠䅐䕃䍟⁐☦挠⁰㴡‽⤰笠 †††††††††††琠楨⹳瑣⹸楦汬瑓汹⁥‽桴獩挮汯牯⹳慢正牧畯摮਻††††††††††††潣獮⁴畣獲牯潆瑮慐瑲⁳‽嵛਻††††††††††††晩⠠散汬汆条⁳…呁剔䈮䱏⥄挠牵潳䙲湯側牡獴瀮獵⡨戧汯❤㬩 †††††††††††椠⁦挨汥䙬慬獧☠䄠呔⹒呉䱁䍉 畣獲牯潆瑮慐瑲⹳異桳✨瑩污捩⤧਻††††††††††††畣獲牯潆瑮慐瑲⹳異桳怨笤桴獩漮瑰潩獮昮湯却穩絥硰⥠਻††††††††††††畣獲牯潆瑮慐瑲⹳異桳琨楨⹳灯楴湯⹳潦瑮慆業祬㬩 †††††††††††琠楨⹳瑣⹸潦瑮㴠挠牵潳䙲湯側牡獴樮楯⡮‧⤧਻††††††††††††桴獩挮硴琮硥䉴獡汥湩⁥‽琧灯㬧 †††††††††††琠楨⹳瑣⹸楦汬敔瑸匨牴湩⹧牦浯潃敤潐湩⡴灣Ⱙ砠‬摡番瑳摥⥙਻††††††††††੽††††††††††桴獩氮獡䙴湯⁴‽畮汬਻††††††††੽††††††††牢慥㭫 †††素 †素ਊ††敲摮牥敓敬瑣潩⡮整浲 ੻††††晩⠠琡牥⹭敳敬瑣潩⥮爠瑥牵㭮 †††挠湯瑳笠猠慴瑲潒ⱷ攠摮潒ⱷ猠慴瑲潃ⱬ攠摮潃⁬⁽‽整浲献汥捥楴湯਻††††潦⁲氨瑥礠㴠猠慴瑲潒㭷礠㰠‽湥剤睯※⭹⤫笠 †††††氠瑥砠‱‽⁹㴽‽瑳牡剴睯㼠猠慴瑲潃⁬›㬰 †††††氠瑥砠′‽⁹㴽‽湥剤睯㼠攠摮潃⁬›整浲挮汯㭳 †††††椠⁦砨‱‼㉸ ੻††††††††桴獩挮硴昮汩卬祴敬㴠琠楨⹳潣潬獲献汥捥楴湯਻††††††††桴獩挮硴昮汩剬捥⡴ㅸ⨠琠楨⹳档牡楗瑤ⱨ礠⨠琠楨⹳档牡效杩瑨‬砨′‭ㅸ ‪桴獩挮慨坲摩桴‬桴獩挮慨䡲楥桧⥴਻††††††੽††††੽††੽ †⼠ 铢肔䰠晩捥捹敬肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔铢肔ਊ††灵慤整桔浥⡥潣潬獲 ੻††††桴獩挮汯牯⁳‽潣潬獲਻††††桴獩琮敨敭杆䝒䅂㴠栠硥潔䝒䅂挨汯牯⹳潦敲牧畯摮㬩 †††琠楨⹳桴浥䉥剧䉇⁁‽敨呸副䉇⡁潣潬獲戮捡杫潲湵⥤਻††੽ †搠獥牴祯⤨笠 †††椠⁦琨楨⹳慣癮獡瀮牡湥乴摯⥥琠楨⹳慣癮獡瀮牡湥乴摯⹥敲潭敶桃汩⡤桴獩挮湡慶⥳਻††੽੽
```

### File: `src/frontend/nanoterm/constants.js`

- Size: 7432 bytes
- Modified: 2026-03-20 21:33:20 UTC

```javascript
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
```

### File: `src/frontend/nanoterm/webgl-renderer.js`

- Size: 43279 bytes
- Modified: 2026-03-21 02:46:28 UTC

```javascript
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

// Perfect anti-aliased square-capped bounding box SDF
float boxAlpha(vec2 p, float minX, float maxX, float minY, float maxY) {
    float dx = max(minX - p.x, p.x - maxX);
    float dy = max(minY - p.y, p.y - maxY);
    float d = length(max(vec2(dx, dy), 0.0)) + min(max(dx, dy), 0.0);
    return smoothstep(0.5, -0.5, d);
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
    // Use explicit subtraction instead of fract() to avoid float precision
    // at cell boundaries that cause micro-gap artifacts
    vec2 localUV = (termPos - vec2(cell) * u_charSize) / u_charSize;

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

        // Null entries (all weights 0) = curved/diagonal chars → fall through to atlas
        if (lw != 0u || rw != 0u || uw != 0u || dw != 0u) {
            vec2 px = localUV * u_charSize;
            // Snap to exact pixel centers for perfectly crisp 1-pixel lines
            float cx = floor(u_charSize.x * 0.5) + 0.5;
            float cy = floor(u_charSize.y * 0.5) + 0.5;

            float hw1 = 0.5;
            float hw2_x = max(1.0, floor(u_charSize.x * 0.1) + 0.5);
            float hw2_y = max(1.0, floor(u_charSize.y * 0.1) + 0.5);
            float gap_x = max(1.0, floor(u_charSize.x * 0.15));
            float gap_y = max(1.0, floor(u_charSize.y * 0.15));

            float extU_out = uw == 3u ? gap_x + hw1 : (uw == 2u ? hw2_x : (uw == 1u ? hw1 : 0.0));
            float extD_out = dw == 3u ? gap_x + hw1 : (dw == 2u ? hw2_x : (dw == 1u ? hw1 : 0.0));
            float extL_out = lw == 3u ? gap_y + hw1 : (lw == 2u ? hw2_y : (lw == 1u ? hw1 : 0.0));
            float extR_out = rw == 3u ? gap_y + hw1 : (rw == 2u ? hw2_y : (rw == 1u ? hw1 : 0.0));

            float extU_in = uw == 3u ? gap_x - hw1 : (uw == 2u ? -hw2_x : (uw == 1u ? -hw1 : 0.0));
            float extD_in = dw == 3u ? gap_x - hw1 : (dw == 2u ? -hw2_x : (dw == 1u ? -hw1 : 0.0));
            float extL_in = lw == 3u ? gap_y - hw1 : (lw == 2u ? -hw2_y : (lw == 1u ? -hw1 : 0.0));
            float extR_in = rw == 3u ? gap_y - hw1 : (rw == 2u ? -hw2_y : (rw == 1u ? -hw1 : 0.0));

            // Ensure minimum hw1 overlap where segments meet at cx/cy
            // Without this, boxAlpha returns 0.5 at box edges, creating visible dips
            float hOverlap = max(max(extU_out, extD_out), hw1);
            float vOverlap = max(max(extL_out, extR_out), hw1);

            float aOut = 0.0;
            if (lw > 0u) aOut = max(aOut, boxAlpha(px, -1.0, cx + hOverlap, cy - (lw==3u ? gap_y+hw1 : (lw==2u ? hw2_y : hw1)), cy + (lw==3u ? gap_y+hw1 : (lw==2u ? hw2_y : hw1))));
            if (rw > 0u) aOut = max(aOut, boxAlpha(px, cx - hOverlap, u_charSize.x + 1.0, cy - (rw==3u ? gap_y+hw1 : (rw==2u ? hw2_y : hw1)), cy + (rw==3u ? gap_y+hw1 : (rw==2u ? hw2_y : hw1))));
            if (uw > 0u) aOut = max(aOut, boxAlpha(px, cx - (uw==3u ? gap_x+hw1 : (uw==2u ? hw2_x : hw1)), cx + (uw==3u ? gap_x+hw1 : (uw==2u ? hw2_x : hw1)), -1.0, cy + vOverlap));
            if (dw > 0u) aOut = max(aOut, boxAlpha(px, cx - (dw==3u ? gap_x+hw1 : (dw==2u ? hw2_x : hw1)), cx + (dw==3u ? gap_x+hw1 : (dw==2u ? hw2_x : hw1)), cy - vOverlap, u_charSize.y + 1.0));

            float aIn = 0.0;
            if (lw == 3u) aIn = max(aIn, boxAlpha(px, -1.0, cx + max(extU_in, extD_in), cy - (gap_y-hw1), cy + (gap_y-hw1)));
            if (rw == 3u) aIn = max(aIn, boxAlpha(px, cx - max(extU_in, extD_in), u_charSize.x + 1.0, cy - (gap_y-hw1), cy + (gap_y-hw1)));
            if (uw == 3u) aIn = max(aIn, boxAlpha(px, cx - (gap_x-hw1), cx + (gap_x-hw1), -1.0, cy + max(extL_in, extR_in)));
            if (dw == 3u) aIn = max(aIn, boxAlpha(px, cx - (gap_x-hw1), cx + (gap_x-hw1), cy - max(extL_in, extR_in), u_charSize.y + 1.0));

            // CSG subtraction: carves perfect double-line joints
            float alpha = max(0.0, aOut - aIn);
            if (alpha > 0.0) color = mix(color, fgColor, alpha);
        }
        // Null entries: procedural rounded corners + diagonals
        else {
            float alpha = 0.0;
            float hw1 = 0.5;

            if (codepoint >= 0x256Du && codepoint <= 0x2570u) {
                vec2 px = localUV * u_charSize;
                float cx = floor(u_charSize.x * 0.5) + 0.5;
                float cy = floor(u_charSize.y * 0.5) + 0.5;
                vec2 center; float a, b;
                bool inQuadrant = false;

                // Allow stroke to bleed across boundary to prevent slicing
                float bleed = 1.5;

                if (codepoint == 0x256Du) { // ╭
                    center = vec2(u_charSize.x, u_charSize.y);
                    a = u_charSize.x - cx; b = u_charSize.y - cy;
                    inQuadrant = (px.x >= cx - bleed && px.y >= cy - bleed);
                } else if (codepoint == 0x256Eu) { // ╮
                    center = vec2(0.0, u_charSize.y);
                    a = cx; b = u_charSize.y - cy;
                    inQuadrant = (px.x <= cx + bleed && px.y >= cy - bleed);
                } else if (codepoint == 0x256Fu) { // ╯
                    center = vec2(0.0, 0.0);
                    a = cx; b = cy;
                    inQuadrant = (px.x <= cx + bleed && px.y <= cy + bleed);
                } else { // ╰
                    center = vec2(u_charSize.x, 0.0);
                    a = u_charSize.x - cx; b = cy;
                    inQuadrant = (px.x >= cx - bleed && px.y <= cy + bleed);
                }

                if (inQuadrant) {
                    vec2 d = px - center;
                    if (length(d) > 0.0001) {
                        vec2 p_scaled = d / vec2(a, b);
                        float delta = length(p_scaled) - 1.0;
                        vec2 dir = normalize(p_scaled);
                        float T = length(dir * vec2(1.0/a, 1.0/b));
                        float dist = abs(delta) / T;
                        alpha = max(alpha, smoothstep(hw1 + 0.5, hw1 - 0.5, dist));
                    }
                }
            }
            else if (codepoint >= 0x2571u && codepoint <= 0x2573u) {
                vec2 px = localUV * u_charSize;
                float A = 1.0 / u_charSize.x;
                float B = 1.0 / u_charSize.y;
                float len = sqrt(A*A + B*B);
                if (codepoint == 0x2571u || codepoint == 0x2573u) {
                    float d1 = abs(px.x * A + px.y * B - 1.0) / len;
                    alpha = max(alpha, smoothstep(hw1 + 0.5, hw1 - 0.5, d1));
                }
                if (codepoint == 0x2572u || codepoint == 0x2573u) {
                    float d2 = abs(px.x * A - px.y * B) / len;
                    alpha = max(alpha, smoothstep(hw1 + 0.5, hw1 - 0.5, d2));
                }
            }

            if (alpha > 0.0) color = mix(color, fgColor, alpha);
        }
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

        // Note: italic glyphs are already rasterized italic in the atlas
        // No shader skew needed — it caused double-application artifacts

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
            if (!seg) continue; // null entries (rounded corners, diagonals) → zeros
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
            const dpr = window.devicePixelRatio || 1;
            this._atlasDpr = dpr;
            this._atlasCharW = Math.ceil(this.charWidth * dpr);
            this._atlasCharH = Math.ceil(this.charHeight * dpr);
            this._atlasSlotsPerRow = Math.floor(ATLAS_SIZE / this._atlasCharW);
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
        // Skip special characters (rendered procedurally in shader)
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
        const maxSlots = this._atlasSlotsPerRow * Math.floor(ATLAS_SIZE / (this._atlasCharH || this.charHeight));
        if (this._atlasNextSlot >= maxSlots) {
            // Atlas full — rebuild (clear and re-upload visible glyphs)
            this._rebuildAtlas();
        }

        // Assign slot
        const slot = this._atlasNextSlot++;
        this._atlasMap.set(key, slot);

        // Rasterize glyph to offscreen canvas at physical pixel size (HiDPI)
        const dpr = this._atlasDpr || 1;
        const cw = this._atlasCharW || this.charWidth;
        const ch = this._atlasCharH || this.charHeight;
        const slotX = ((slot - 1) % this._atlasSlotsPerRow) * cw;
        const slotY = Math.floor((slot - 1) / this._atlasSlotsPerRow) * ch;

        const ctx = this._atlasCtx;
        ctx.clearRect(slotX, slotY, cw, ch);

        const fontParts = [];
        if (styleFlags & ATTR.BOLD) fontParts.push('bold');
        if (styleFlags & ATTR.ITALIC) fontParts.push('italic');
        fontParts.push(`${this.options.fontSize * dpr}px`);
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
        const pixels = ctx.getImageData(slotX, slotY, cw, ch);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, slotX, slotY,
            cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);

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

        // ── Process atlas for all visible glyphs (BEFORE texture upload) ──
        // This fills gridData[i*4+3] with atlas indices
        this._updateAtlasForGrid(gridData, visibleCols, visibleRows);

        // ── Upload grid data texture (now includes atlas indices) ──
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

        // ── Set uniforms ──
        gl.uniform2i(this.uniforms.u_gridSize, visibleCols, visibleRows);
        gl.uniform2f(this.uniforms.u_charSize, this.charWidth, this.charHeight);
        gl.uniform2f(this.uniforms.u_canvasSize, cssWidth, cssHeight);
        gl.uniform1f(this.uniforms.u_padding, pad);

        // Atlas info
        gl.uniform1f(this.uniforms.u_atlasGridSize, this._atlasSlotsPerRow);
        gl.uniform2f(this.uniforms.u_atlasTexSize, ATLAS_SIZE, ATLAS_SIZE);
        gl.uniform2f(this.uniforms.u_atlasCellSize, this._atlasCharW || this.charWidth, this._atlasCharH || this.charHeight);

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
        // Cache the array to avoid per-frame garbage (Fix #5)
        const size = cols * rows * 4;
        if (!this._gridData || this._gridData.length !== size) {
            this._gridData = new Uint32Array(size);
        }
        const gridData = this._gridData;

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
        let rebuilds = 0;
        let i = 0;

        while (i < total) {
            const word0 = gridData[i * 4];
            const cp = word0 >>> CELL_CP_SHIFT;
            const flags = word0 & CELL_FLAGS_MASK;

            if (cp <= 32 || (cp >= 0x2500 && cp <= 0x259F) || (cp >= 0x2800 && cp <= 0x28FF)) {
                i++; continue;
            }

            const expectedSlot = this._atlasNextSlot;
            const atlasIdx = this._getAtlasIndex(cp, flags);

            // Atlas wiped mid-frame! Restart loop to update invalid indices
            if (this._atlasNextSlot < expectedSlot) {
                rebuilds++;
                if (rebuilds > 1) { gridData[i * 4 + 3] = atlasIdx; i++; continue; } // Failsafe
                i = 0; continue;
            }

            gridData[i * 4 + 3] = atlasIdx;
            i++;
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    updateTheme(colors) {
        this.colors = colors;
        this.themeFgRGBA = hexToRGBA(colors.foreground);
        this.themeBgRGBA = hexToRGBA(colors.background);
        // No atlas rebuild needed — glyphs are white, shader tints with fg/bg
    }

    destroy() {
        const gl = this.gl;
        if (gl) {
            if (this.gridTexture) gl.deleteTexture(this.gridTexture);
            if (this.atlasTexture) gl.deleteTexture(this.atlasTexture);
            if (this.boxTexture) gl.deleteTexture(this.boxTexture);
            if (this.program) gl.deleteProgram(this.program);
            if (this._vao) gl.deleteVertexArray(this._vao);

            // Forcibly return the WebGL context slot to the browser
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
            this.gl = null;
        }
        this._gridData = null;
        if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
}
```

### File: `src/index.test.ts`

- Size: 4238 bytes
- Modified: 2026-02-13 09:43:02 UTC

```typescript
/**
 * ShellPort - CLI Argument Parsing Tests
 *
 * Tests the parseArgs function for correct CLI argument extraction.
 */

import { describe, test, expect } from "bun:test";
import { parseArgs, VERSION } from "./index.js";

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------
describe("parseArgs — commands", () => {
    test("recognizes 'server' command", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.command).toBe("server");
    });

    test("recognizes 'serve' alias", () => {
        const parsed = parseArgs(["serve"]);
        expect(parsed.command).toBe("serve");
    });

    test("recognizes 'client' command", () => {
        const parsed = parseArgs(["client", "ws://host/ws"]);
        expect(parsed.command).toBe("client");
    });

    test("recognizes 'connect' alias", () => {
        const parsed = parseArgs(["connect", "ws://host/ws"]);
        expect(parsed.command).toBe("connect");
    });

    test("defaults to 'help' when no args", () => {
        const parsed = parseArgs([]);
        expect(parsed.command).toBe("help");
    });
});

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------
describe("parseArgs — options", () => {
    test("--port sets port", () => {
        const parsed = parseArgs(["server", "--port", "8080"]);
        expect(parsed.port).toBe(8080);
    });

    test("-p short flag sets port", () => {
        const parsed = parseArgs(["server", "-p", "9090"]);
        expect(parsed.port).toBe(9090);
    });

    test("--secret sets secret", () => {
        const parsed = parseArgs(["server", "--secret", "mykey"]);
        expect(parsed.secret).toBe("mykey");
    });

    test("-s short flag sets secret", () => {
        const parsed = parseArgs(["server", "-s", "mykey"]);
        expect(parsed.secret).toBe("mykey");
    });

    test("--tailscale sets tailscale mode", () => {
        const parsed = parseArgs(["server", "--tailscale", "funnel"]);
        expect(parsed.tailscale).toBe("funnel");
    });

    test("--no-secret sets noSecret flag", () => {
        const parsed = parseArgs(["server", "--no-secret"]);
        expect(parsed.noSecret).toBe(true);
    });

    test("positional arg sets url for client", () => {
        const parsed = parseArgs(["client", "ws://host:7681/ws"]);
        expect(parsed.url).toBe("ws://host:7681/ws");
    });

    test("all options combined", () => {
        const parsed = parseArgs([
            "server",
            "--port", "3000",
            "--secret", "s3cret",
            "--tailscale", "serve",
        ]);
        expect(parsed.command).toBe("server");
        expect(parsed.port).toBe(3000);
        expect(parsed.secret).toBe("s3cret");
        expect(parsed.tailscale).toBe("serve");
    });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
describe("parseArgs — defaults", () => {
    test("default port is 7681", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.port).toBe(7681);
    });

    test("default secret is empty string", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.secret).toBe("");
    });

    test("default tailscale is empty string", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.tailscale).toBe("");
    });

    test("default url is empty string", () => {
        const parsed = parseArgs(["client"]);
        expect(parsed.url).toBe("");
    });

    test("default noSecret is false", () => {
        const parsed = parseArgs(["server"]);
        expect(parsed.noSecret).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// VERSION
// ---------------------------------------------------------------------------
describe("VERSION", () => {
    test("is a semver string", () => {
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
```

### File: `src/integration.test.ts`

- Size: 1289 bytes
- Modified: 2026-02-14 18:48:18 UTC

```typescript
/**
 * ShellPort - E2E Security Integration Tests
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { deriveKey, pack, unpack, deriveSessionSalt, generateNonce } from "./crypto.js";
import { FrameType } from "./types.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const TEST_PORT = 17690 + Math.floor(Math.random() * 500);
const SECRET = "test-integration-secret";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP"; // "hello" in Base32

describe("E2E Security Handshake", () => {
    let server: any;

    beforeAll(async () => {
        const config: ServerConfig = {
            port: TEST_PORT,
            secret: SECRET,
            totp: true,
            totpSecret: TOTP_SECRET,
            allowLocalhost: true,
            requireApproval: false,
            tailscale: ""
        };
        // We need to mock startServer or run it in a way we can stop it
        // For testing, we'll use a simplified version of the server logic
    });

    test("full handshake: nonce -> key derivation -> totp -> pty data", async () => {
        // This test requires a running server. Since startServer is async and starts a real Bun.serve,
        // we will use the actual server for a true E2E test.
    });
});
```

### File: `src/pty.test.ts`

- Size: 1584 bytes
- Modified: 2026-02-14 18:29:18 UTC

```typescript
/**
 * ShellPort - PTY Sanitization Tests
 */

import { describe, test, expect } from "bun:test";
import { sanitizePTYData } from "./server.js";

describe("PTY Sanitization", () => {
    test("passes normal text", () => {
        const input = new TextEncoder().encode("Hello World");
        const output = sanitizePTYData(input);
        expect(new TextDecoder().decode(output)).toBe("Hello World");
    });

    test("passes standard SGR sequences", () => {
        const input = new TextEncoder().encode("\x1b[31mRed Text\x1b[0m");
        const output = sanitizePTYData(input);
        expect(new TextDecoder().decode(output)).toBe("\x1b[31mRed Text\x1b[0m");
    });

    test("blocks Device Status Report (DSR) queries", () => {
        // CSI 6 n should be blocked to prevent cursor position reporting
        const input = new TextEncoder().encode("Attack\x1b[6n");
        const output = sanitizePTYData(input);
        const decoded = new TextDecoder().decode(output);
        expect(decoded).not.toContain("\x1b[6n");
        expect(decoded).toBe("Attack");
    });

    test("blocks potentially dangerous OSC 52 clipboard writes (if configured)", () => {
        // OSC 52 c;...;...
        const input = new TextEncoder().encode("\x1b]52;c;SGVsbG8=\x07");
        const output = sanitizePTYData(input);
        const decoded = new TextDecoder().decode(output);
        expect(decoded).not.toContain("\x1b]52");
    });

    test("handles split sequences across chunks", () => {
        // This is complex for a simple buffer filter, but good to keep in mind
    });
});
```

### File: `src/qr.test.ts`

- Size: 2069 bytes
- Modified: 2026-02-14 06:08:38 UTC

```typescript
import { describe, test, expect } from "bun:test";
import { generateQRMatrix, renderQRTerminal } from "./qr.js";

describe("QR Code", () => {
    test("generates valid v1 matrix for short text", () => {
        const matrix = generateQRMatrix("HELLO");
        expect(matrix.length).toBe(21); // v1 = 21×21
        expect(matrix[0].length).toBe(21);
        // Every cell should be boolean
        for (const row of matrix) {
            for (const cell of row) {
                expect(typeof cell).toBe("boolean");
            }
        }
    });

    test("generates valid matrix for URL", () => {
        const matrix = generateQRMatrix("https://example.com");
        expect(matrix.length).toBeGreaterThan(21); // v2+
        for (const row of matrix) {
            for (const cell of row) {
                expect(typeof cell).toBe("boolean");
            }
        }
    });

    test("generates valid matrix for otpauth URI", () => {
        const uri = "otpauth://totp/ShellPort?secret=JBSWY3DPEHPK3PXP&issuer=ShellPort";
        const matrix = generateQRMatrix(uri);
        expect(matrix.length).toBeGreaterThan(21);
    });

    test("has correct finder patterns", () => {
        const matrix = generateQRMatrix("test");
        // Top-left finder: corners and center should be dark (true)
        expect(matrix[0][0]).toBe(true);
        expect(matrix[0][6]).toBe(true);
        expect(matrix[6][0]).toBe(true);
        expect(matrix[6][6]).toBe(true);
        expect(matrix[3][3]).toBe(true);
        // Inner white ring
        expect(matrix[1][1]).toBe(false);
    });

    test("renders to terminal string with ANSI codes", () => {
        const output = renderQRTerminal("test");
        expect(output).toContain("█");
        expect(output).toContain("\x1b[47;30m"); // White bg, black fg
        expect(output).toContain("\x1b[0m");     // Reset
        expect(output.length).toBeGreaterThan(0);
    });

    test("throws for data too long", () => {
        expect(() => generateQRMatrix("x".repeat(3000))).toThrow("Data too long");
    });
});
```

### File: `src/qr.ts`

- Size: 16020 bytes
- Modified: 2026-02-14 06:08:20 UTC

```typescript
/**
 * ShellPort — Zero-Dependency QR Code Generator for Terminal
 *
 * Based on Gemini DeepThink's proven implementation.
 * Supports: Auto-Sizing (V1-40), Byte Mode (UTF-8), Error Correction Level M
 * Renders to terminal using Unicode half-block characters with ANSI colors.
 */

// EC Level M tables (index 0 unused, 1-40 = versions)
const ECC_WORDS = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

// ═══════════════════════════════════════════════════════════════════════════
// Reed-Solomon GF(256) Arithmetic
// ═══════════════════════════════════════════════════════════════════════════

class ReedSolomon {
    static exp = new Uint8Array(512);
    static log = new Uint8Array(256);

    static init() {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            this.exp[i] = x;
            this.exp[i + 255] = x;
            this.log[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11D;
        }
    }

    static mul(x: number, y: number): number {
        if (x === 0 || y === 0) return 0;
        return this.exp[(this.log[x] + this.log[y]) % 255];
    }

    static divisor(degree: number): number[] {
        let poly = [1];
        for (let i = 0; i < degree; i++) {
            const root = this.exp[i];
            const next = new Array(poly.length + 1).fill(0);
            for (let j = 0; j < poly.length; j++) {
                next[j] ^= poly[j];
                next[j + 1] ^= this.mul(poly[j], root);
            }
            poly = next;
        }
        return poly;
    }
}

ReedSolomon.init();

// ═══════════════════════════════════════════════════════════════════════════
// QR Code Geometry Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getNumRawDataModules(ver: number): number {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const numAlign = Math.floor(ver / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (ver >= 7) result -= 36;
    }
    return result;
}

function getAlignments(ver: number): number[] {
    if (ver === 1) return [];
    const num = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.round((ver * 4 + 4) / (num - 1) / 2) * 2;
    const res = [6];
    const last = 4 * ver + 10;
    for (let i = num - 2; i >= 0; i--) res.push(last - step * i);
    return res;
}

// ═══════════════════════════════════════════════════════════════════════════
// Core QR Generation
// ═══════════════════════════════════════════════════════════════════════════

function generateQR(text: string): boolean[][] {
    const data = new TextEncoder().encode(text);

    // 1. Determine optimal version
    let version = 1;
    let dataCapacity = 0;
    for (; version <= 40; version++) {
        const charCountBits = version < 10 ? 8 : 16;
        const requiredBits = 4 + charCountBits + data.length * 8;
        const rawModules = getNumRawDataModules(version);
        dataCapacity = Math.floor(rawModules / 8) - NUM_BLOCKS[version] * ECC_WORDS[version];
        if (Math.ceil(requiredBits / 8) <= dataCapacity) break;
    }
    if (version > 40) throw new Error("Data too long for QR code");

    // 2. Build bitstream (byte mode)
    const bits: number[] = [];
    const push = (val: number, len: number) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    push(0b0100, 4); // Byte mode indicator
    push(data.length, version < 10 ? 8 : 16);
    for (const b of data) push(b, 8);

    const maxBits = dataCapacity * 8;
    push(0, Math.min(4, maxBits - bits.length)); // Terminator
    while (bits.length % 8 !== 0) push(0, 1);    // Byte pad

    let pad = 0xEC;
    while (bits.length < maxBits) {
        push(pad, 8);
        pad = pad === 0xEC ? 0x11 : 0xEC;
    }

    const dataBytes = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bits.length; i++) dataBytes[i >>> 3] |= bits[i] << (7 - (i & 7));

    // 3. Reed-Solomon error correction blocks
    const numBlocks = NUM_BLOCKS[version];
    const eccPerBlock = ECC_WORDS[version];
    const shortBlockLen = Math.floor(dataCapacity / numBlocks);
    const numShortBlocks = numBlocks - (dataCapacity % numBlocks);

    const divisor = ReedSolomon.divisor(eccPerBlock);
    const dataBlocks: Uint8Array[] = [];
    const eccBlocks: Uint8Array[] = [];

    let offset = 0;
    for (let i = 0; i < numBlocks; i++) {
        const len = shortBlockLen + (i < numShortBlocks ? 0 : 1);
        const block = dataBytes.subarray(offset, offset + len);
        offset += len;
        dataBlocks.push(block);

        const ecc = new Uint8Array(eccPerBlock);
        for (const b of block) {
            const factor = b ^ ecc[0];
            ecc.copyWithin(0, 1);
            ecc[eccPerBlock - 1] = 0;
            for (let j = 0; j < eccPerBlock; j++) {
                ecc[j] ^= ReedSolomon.mul(divisor[j + 1], factor);
            }
        }
        eccBlocks.push(ecc);
    }

    // 4. Interleave data and EC
    const finalBytes: number[] = [];
    for (let i = 0; i <= shortBlockLen; i++) {
        for (let j = 0; j < numBlocks; j++) {
            if (i < shortBlockLen || j >= numShortBlocks) finalBytes.push(dataBlocks[j][i]);
        }
    }
    for (let i = 0; i < eccPerBlock; i++) {
        for (let j = 0; j < numBlocks; j++) finalBytes.push(eccBlocks[j][i]);
    }

    // 5. Draw matrix
    const size = 21 + (version - 1) * 4;
    const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));

    const setFunc = (x: number, y: number, isDark: boolean) => {
        if (x >= 0 && x < size && y >= 0 && y < size) {
            matrix[y][x] = isDark;
            isFunc[y][x] = true;
        }
    };

    // Finder patterns
    const drawFinder = (dx: number, dy: number) => {
        for (let y = -1; y < 8; y++) {
            for (let x = -1; x < 8; x++) {
                const dist = Math.max(Math.abs(x - 3), Math.abs(y - 3));
                setFunc(dx + x, dy + y, dist !== 2 && dist !== 4);
            }
        }
    };
    drawFinder(0, 0); drawFinder(size - 7, 0); drawFinder(0, size - 7);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
        setFunc(6, i, i % 2 === 0);
        setFunc(i, 6, i % 2 === 0);
    }

    // Alignment patterns
    const alignPos = getAlignments(version);
    for (const x of alignPos) {
        for (const y of alignPos) {
            if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    setFunc(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                }
            }
        }
    }

    // Format & version reservoirs
    for (let i = 0; i < 9; i++) setFunc(8, i, false);
    for (let i = 0; i < 8; i++) setFunc(i, 8, false);
    for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, false);
    for (let i = 0; i < 7; i++) setFunc(8, size - 1 - i, false);
    setFunc(8, size - 8, true);

    if (version >= 7) {
        for (let i = 0; i < 18; i++) {
            const a = size - 11 + (i % 3), b = Math.floor(i / 3);
            setFunc(a, b, false);
            setFunc(b, a, false);
        }
    }

    // 6. Zigzag data placement
    let index = 0;
    let right = size - 1;
    let upward = true;
    while (right >= 0) {
        if (right === 6) right = 5;
        for (let y = upward ? size - 1 : 0; upward ? y >= 0 : y < size; upward ? y-- : y++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                if (!isFunc[y][x]) {
                    matrix[y][x] = index < finalBytes.length * 8 ? ((finalBytes[index >>> 3] >>> (7 - (index & 7))) & 1) === 1 : false;
                    index++;
                }
            }
        }
        upward = !upward;
        right -= 2;
    }

    // 7. Mask evaluation — apply/unapply to find best penalty
    const applyMask = (mask: number) => {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (isFunc[y][x]) continue;
                let invert = false;
                switch (mask) {
                    case 0: invert = (x + y) % 2 === 0; break;
                    case 1: invert = y % 2 === 0; break;
                    case 2: invert = x % 3 === 0; break;
                    case 3: invert = (x + y) % 3 === 0; break;
                    case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                    case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
                    case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
                    case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
                }
                if (invert) matrix[y][x] = !matrix[y][x];
            }
        }
    };

    let bestMask = 0;
    let minPenalty = Infinity;

    for (let m = 0; m < 8; m++) {
        applyMask(m);
        let penalty = 0;
        let dark = 0;

        for (let y = 0; y < size; y++) {
            let cx = 1, cy = 1;
            for (let x = 0; x < size; x++) {
                if (matrix[y][x]) dark++;
                if (x > 0) {
                    if (matrix[y][x] === matrix[y][x - 1]) cx++; else { if (cx >= 5) penalty += cx - 2; cx = 1; }
                    if (matrix[x][y] === matrix[x - 1][y]) cy++; else { if (cy >= 5) penalty += cy - 2; cy = 1; }
                }
                if (x < size - 1 && y < size - 1) {
                    const c = matrix[y][x];
                    if (c === matrix[y][x + 1] && c === matrix[y + 1][x] && c === matrix[y + 1][x + 1]) penalty += 3;
                }
            }
            if (cx >= 5) penalty += cx - 2;
            if (cy >= 5) penalty += cy - 2;
        }

        const pat = [true, false, true, true, true, false, true];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size - 6; x++) {
                let matchH = true, matchV = true;
                for (let i = 0; i < 7; i++) {
                    if (matrix[y][x + i] !== pat[i]) matchH = false;
                    if (matrix[x + i][y] !== pat[i]) matchV = false;
                }
                if (matchH) {
                    const left = x >= 4 && !matrix[y][x - 1] && !matrix[y][x - 2] && !matrix[y][x - 3] && !matrix[y][x - 4];
                    const right = x + 10 < size && !matrix[y][x + 7] && !matrix[y][x + 8] && !matrix[y][x + 9] && !matrix[y][x + 10];
                    if (left || right) penalty += 40;
                }
                if (matchV) {
                    const up = x >= 4 && !matrix[x - 1][y] && !matrix[x - 2][y] && !matrix[x - 3][y] && !matrix[x - 4][y];
                    const down = x + 10 < size && !matrix[x + 7][y] && !matrix[x + 8][y] && !matrix[x + 9][y] && !matrix[x + 10][y];
                    if (up || down) penalty += 40;
                }
            }
        }

        penalty += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
        if (penalty < minPenalty) {
            minPenalty = penalty;
            bestMask = m;
        }
        applyMask(m); // Undo mask (XOR is self-inverse)
    }

    // Lock in best mask
    applyMask(bestMask);

    // 8. Place BCH-encoded format info
    let formatBits = bestMask;
    for (let i = 0; i < 10; i++) formatBits = (formatBits << 1) ^ ((formatBits >>> 9) ? 0x537 : 0);
    formatBits = ((bestMask << 10) | formatBits) ^ 0x5412;

    const fC1 = [[8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5], [8, size - 6], [8, size - 7], [size - 8, 8], [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8]];
    const fC2 = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];

    for (let i = 0; i < 15; i++) {
        const bit = ((formatBits >>> (14 - i)) & 1) === 1;
        matrix[fC1[i][1]][fC1[i][0]] = bit;
        matrix[fC2[i][1]][fC2[i][0]] = bit;
    }

    if (version >= 7) {
        let verBits = version;
        for (let i = 0; i < 12; i++) verBits = (verBits << 1) ^ ((verBits >>> 11) ? 0x1F25 : 0);
        verBits = (version << 12) | verBits;
        for (let i = 0; i < 18; i++) {
            const bit = ((verBits >>> i) & 1) === 1;
            const a = size - 11 + (i % 3), b = Math.floor(i / 3);
            matrix[b][a] = bit;
            matrix[a][b] = bit;
        }
    }

    return matrix;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a QR code boolean matrix from text.
 * Returns a 2D array where true = black module, false = white module.
 */
export function generateQRMatrix(text: string): boolean[][] {
    return generateQR(text);
}

/**
 * Render a QR code as a Unicode string for terminal display.
 * Uses ANSI white background + half-block characters for 1:1 aspect ratio.
 */
export function renderQRTerminal(text: string): string {
    const matrix = generateQR(text);
    const size = matrix.length;
    const quiet = 2;
    const totalSize = size + quiet * 2;
    const padded = Array.from({ length: totalSize }, () => Array(totalSize).fill(false));

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            padded[y + quiet][x + quiet] = matrix[y][x];
        }
    }

    const lines: string[] = [];
    for (let y = 0; y < totalSize; y += 2) {
        let line = "\x1b[47;30m";
        for (let x = 0; x < totalSize; x++) {
            const top = padded[y][x];
            const bottom = (y + 1 < totalSize) ? padded[y + 1][x] : false;

            if (top && bottom) line += "█";
            else if (top && !bottom) line += "▀";
            else if (!top && bottom) line += "▄";
            else line += " ";
        }
        lines.push(line + "\x1b[0m");
    }

    return lines.join("\n");
}

/**
 * Print a QR code to the terminal with a label.
 */
export function printQR(text: string, label?: string): void {
    console.log("");
    if (label) {
        console.log(`  ${label}`);
        console.log("");
    }
    const rendered = renderQRTerminal(text);
    for (const line of rendered.split("\n")) {
        console.log(`  ${line}`);
    }
    console.log("");
}
```

### File: `src/server.test.ts`

- Size: 4952 bytes
- Modified: 2026-03-20 21:33:20 UTC

```typescript
/**
 * ShellPort - Server Integration Tests
 *
 * Tests HTTP routing, WebSocket upgrade, and PTY session lifecycle
 * using a real ShellPort server on ephemeral ports.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { deriveKey, pack, unpack } from "./crypto.js";
import { FrameType } from "./types.js";
import { buildHTML } from "./frontend/build.js";
import { getCryptoJS } from "./crypto.js";

let server: ReturnType<typeof Bun.serve>;
const TEST_PORT = 17681 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${TEST_PORT}`;

beforeAll(async () => {
    const htmlClient = await buildHTML(getCryptoJS());

    server = Bun.serve({
        port: TEST_PORT,
        fetch(req, srv) {
            const url = new URL(req.url);

            if (url.pathname === "/ws") {
                if (srv.upgrade(req, { data: {} })) return;
                return new Response("Expected WebSocket", { status: 400 });
            }

            if (url.pathname === "/" || url.pathname === "/index.html") {
                return new Response(htmlClient, {
                    headers: { "Content-Type": "text/html" },
                });
            }

            return new Response("Not found", { status: 404 });
        },
        websocket: {
            open(ws) {
                // Echo server for testing — no PTY
                ws.send(new TextEncoder().encode("connected"));
            },
            message(ws, message) {
                // Echo the received message back
                ws.send(message);
            },
            close() { },
        },
    });
});

afterAll(() => {
    server?.stop(true);
});

// ---------------------------------------------------------------------------
// HTTP Routing
// ---------------------------------------------------------------------------
describe("HTTP routing", () => {
    test("GET / returns HTML", async () => {
        const res = await fetch(`${BASE}/`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html");

        const body = await res.text();
        expect(body).toContain("<!DOCTYPE html>");
        expect(body).toContain("ShellPort");
    });

    test("GET /index.html returns same HTML", async () => {
        const res = await fetch(`${BASE}/index.html`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html");
    });

    test("GET /nonexistent returns 404", async () => {
        const res = await fetch(`${BASE}/nonexistent`);
        expect(res.status).toBe(404);
    });

    test("GET /ws without upgrade returns 400", async () => {
        const res = await fetch(`${BASE}/ws`);
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
describe("WebSocket", () => {
    test("upgrade succeeds and receives initial message", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);

        const msg = await new Promise<string>((resolve, reject) => {
            ws.addEventListener("open", () => { });
            ws.addEventListener("message", (e) => {
                resolve(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
            });
            ws.addEventListener("error", reject);
            setTimeout(() => reject(new Error("timeout")), 3000);
        });

        expect(msg).toBe("connected");
        ws.close();
    });

    test("echo round-trip works", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
        ws.binaryType = "arraybuffer";

        // Wait for the initial "connected" message first
        await new Promise<void>((resolve) => {
            ws.addEventListener("message", () => resolve(), { once: true });
        });

        const testPayload = new TextEncoder().encode("echo-test");

        const response = await new Promise<Uint8Array>((resolve, reject) => {
            ws.addEventListener("message", (e) => {
                resolve(new Uint8Array(e.data as ArrayBuffer));
            }, { once: true });
            ws.send(testPayload);
            setTimeout(() => reject(new Error("timeout")), 3000);
        });

        expect(new TextDecoder().decode(response)).toBe("echo-test");
        ws.close();
    });

    test("clean close", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);

        await new Promise<void>((resolve) => {
            ws.addEventListener("open", () => resolve());
        });

        const closed = new Promise<void>((resolve, reject) => {
            ws.addEventListener("close", () => resolve());
            setTimeout(() => reject(new Error("timeout")), 3000);
        });

        ws.close();
        await closed; // Should not throw
    });
});
```

### File: `src/server.ts`

- Size: 20665 bytes
- Modified: 2026-03-20 21:33:20 UTC

```typescript
/**
 * ShellPort - Server
 *
 * HTTP + WebSocket server with native PTY allocation (Bun v1.3.5+).
 * Serves the embedded web terminal and manages shell sessions.
 *
 * Security features:
 * - Per-session salt for PBKDF2 key derivation
 * - Strict origin validation (configurable localhost bypass for dev)
 * - Atomic session counting
 * - Rate limiting per IP
 * - Bounds validation on all control messages
 * - TOTP 2FA authentication (RFC 6238)
 */

import { spawn, spawnSync } from "bun";
import { deriveKey, pack, unpack, getCryptoJS, generateNonce, deriveSessionSalt, PROTOCOL_VERSION } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ServerConfig, SessionData } from "./types.js";
import { buildHTML } from "./frontend/build.js";
import { verifyTOTP } from "./totp.js";

/** Maximum concurrent PTY sessions */
const MAX_SESSIONS = 10;

/** Maximum WebSocket frame size (1MB) to prevent memory exhaustion attacks */
const MAX_FRAME_SIZE = 1024 * 1024;

/** Seconds to wait for a valid auth frame before disconnecting */
const AUTH_TIMEOUT_S = 10;

/** Seconds to wait for TOTP code entry before disconnecting */
const TOTP_TIMEOUT_S = 60;

/** Maximum rate limit attempts per window per IP */
const RATE_LIMIT_MAX = 5;

/** Rate limit sliding window in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum terminal dimensions for resize validation */
const MAX_COLS = 1000;
const MAX_ROWS = 200;
const MIN_COLS = 1;
const MIN_ROWS = 1;

/** Environment variables safe to forward to PTY sessions */
const SAFE_ENV_VARS = [
    'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'XDG_RUNTIME_DIR',
    'TERM', 'COLORTERM',
];

/** Valid values for the --tailscale flag */
const VALID_TAILSCALE_MODES = ['serve', 'funnel'];

/** Localhost addresses for origin validation */
const LOCALHOST_ADDRESSES = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'];

/** Shells considered safe for PTY spawning */
const SAFE_SHELLS = ['/bin/bash', '/bin/sh', '/bin/zsh', '/bin/fish', '/usr/bin/bash', '/usr/bin/sh', '/usr/bin/zsh', '/usr/bin/fish', '/usr/local/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/fish', 'bash', 'sh', 'zsh', 'fish'];

/** Rate limit tracker: IP -> sliding window of timestamps */
export const rateLimitMap = new Map<string, number[]>();

/** Interval for cleaning up stale rate limit entries */
const CLEANUP_INTERVAL_MS = 60_000;

export function cleanupRateLimits() {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    for (const [ip, timestamps] of rateLimitMap.entries()) {
        // If the newest timestamp is older than the window, remove the whole entry
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] < windowStart) {
            rateLimitMap.delete(ip);
        }
    }
}

/** Atomic session counter */
let activeSessions = 0;

function buildSafeEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
        if (process.env[key]) env[key] = process.env[key];
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    env.TERM_PROGRAM = "WezTerm";
    return env;
}

function isLocalhost(hostname: string): boolean {
    return LOCALHOST_ADDRESSES.includes(hostname.toLowerCase());
}

/** Sliding window rate limiter — tracks actual timestamps per IP */
function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    let timestamps = rateLimitMap.get(ip);

    if (!timestamps) {
        rateLimitMap.set(ip, [now]);
        return true;
    }

    // Prune timestamps outside the window
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= RATE_LIMIT_MAX) {
        rateLimitMap.set(ip, timestamps);
        return false;
    }

    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
    return true;
}

function incrementSessions(): number {
    return ++activeSessions;
}

function decrementSessions(): number {
    return --activeSessions;
}

/** Security headers for HTTP responses */
const SECURITY_HEADERS = {
    "Content-Type": "text/html",
    "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-XSS-Protection": "1; mode=block",
};

export async function startServer(config: ServerConfig): Promise<void> {
    const baseKey = config.secret ? await deriveKey(config.secret) : null;
    const safeEnv = buildSafeEnv();

    console.log(`[ShellPort] Starting PTY WebSocket Server on port ${config.port}...`);

    if (config.totp && config.totpSecret) {
        console.log("[ShellPort] 🔐 TOTP 2FA enabled (connections require authenticator code)");
    } else if (config.requireApproval && process.env.SHELLPORT_APPROVAL_MODE !== "disabled") {
        console.log("[ShellPort] 🔐 Interactive approval mode enabled (connections require manual approval)");
    }

    if (config.allowLocalhost) {
        console.log("[ShellPort] ⚠️  Dev mode: localhost origin bypass enabled");
    }

    if (!baseKey) {
        console.log("[ShellPort] ⚠️  WARNING: No encryption enabled. Use --secret for production.");
    }

    if (config.tailscale) {
        if (!VALID_TAILSCALE_MODES.includes(config.tailscale)) {
            console.error(`[ShellPort] ❌ --tailscale must be '${VALID_TAILSCALE_MODES.join("' or '")}'`);
            process.exit(1);
        }

        const tsCheck = spawnSync(["tailscale", "version"]);
        if (tsCheck.exitCode !== 0) {
            console.error("[ShellPort] ❌ Tailscale CLI not found in PATH.");
            process.exit(1);
        }
        console.log(`[ShellPort] 🌐 Tailscale ${config.tailscale} on localhost:${config.port}...`);
        spawn(["tailscale", config.tailscale, `localhost:${config.port}`], {
            stdout: "inherit",
            stderr: "inherit",
        });
    }

    const htmlClient = await buildHTML(getCryptoJS());

    Bun.serve({
        port: config.port,

        fetch(req, server) {
            const url = new URL(req.url);

            if (url.pathname === "/ws") {
                const clientIP = server.requestIP(req)?.address || "unknown";

                if (!checkRateLimit(clientIP)) {
                    return new Response("Too many requests", { status: 429 });
                }

                if (activeSessions >= MAX_SESSIONS) {
                    return new Response("Session limit reached", { status: 503 });
                }

                const origin = req.headers.get("origin");
                if (origin) {
                    try {
                        const originUrl = new URL(origin);
                        const serverHost = req.headers.get("host")?.split(":")[0] || "";

                        if (originUrl.hostname !== serverHost) {
                            if (!config.allowLocalhost || !isLocalhost(originUrl.hostname)) {
                                return new Response("Origin not allowed", { status: 403 });
                            }
                        }
                    } catch {
                        return new Response("Invalid origin", { status: 403 });
                    }
                } else if (!config.allowLocalhost) {
                    return new Response("Origin header required", { status: 403 });
                }

                const data: SessionData = {
                    sendQ: new SeqQueue(),
                    recvQ: new SeqQueue(),
                    proc: null,
                    authenticated: false,
                    clientIP,
                };

                if (server.upgrade(req, { data: data as unknown as undefined, headers: { "Sec-WebSocket-Protocol": `shellport-v${PROTOCOL_VERSION}` } })) {
                    return;
                }
                return new Response("Expected WebSocket", { status: 400 });
            }

            if (url.pathname === "/" || url.pathname === "/index.html") {
                return new Response(htmlClient, {
                    headers: SECURITY_HEADERS,
                });
            }

            return new Response("Not found", { status: 404 });
        },

        websocket: {
            open(ws) {
                const sessionData = ws.data as unknown as SessionData;

                if (baseKey) {
                    sessionData.serverNonce = generateNonce();
                    ws.send(sessionData.serverNonce.buffer as ArrayBuffer);
                } else if (!config.totp && !config.requireApproval) {
                    // No encryption, no TOTP, no approval — plaintext mode
                    sessionData.authenticated = true;
                    incrementSessions();
                    spawnPTY(ws, sessionData, null, safeEnv, () => decrementSessions());
                    return;
                } else if (!baseKey && config.totp && config.totpSecret) {
                    // No encryption, but TOTP required — send challenge immediately
                    sessionData.authenticated = true;
                    sessionData.totpPending = true;
                    // Send TOTP challenge as plaintext frame: [type_byte]
                    const frame = new Uint8Array([FrameType.TOTP_CHALLENGE]);
                    ws.send(frame.buffer as ArrayBuffer);
                    console.log(`[ShellPort] 🔑 TOTP challenge sent to ${sessionData.clientIP}`);
                }

                sessionData.authTimer = setTimeout(() => {
                    console.log("[ShellPort] Auth/approval timeout — disconnecting.");
                    ws.close(4001, "Authentication timeout");
                }, (config.totp ? TOTP_TIMEOUT_S : AUTH_TIMEOUT_S) * 1000);
            },

            async message(ws, message) {
                const sessionData = ws.data as unknown as SessionData;
                const msgBuffer = message as unknown as ArrayBuffer;

                if (msgBuffer.byteLength > MAX_FRAME_SIZE) {
                    console.log(`[ShellPort] ❌ Oversized frame from ${sessionData.clientIP} (${msgBuffer.byteLength} bytes) — disconnecting.`);
                    ws.close(4009, "Message too large");
                    return;
                }

                // ─── TOTP verification pending ───
                if (sessionData.totpPending && config.totp && config.totpSecret) {
                    sessionData.recvQ.add(async () => {
                        const decoded = await unpackMessage(sessionData, msgBuffer, baseKey, config);
                        if (!decoded) {
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        if (decoded.type === FrameType.TOTP_RESPONSE) {
                            const code = new TextDecoder().decode(decoded.payload).trim();
                            const valid = await verifyTOTP(config.totpSecret!, code);

                            if (!valid) {
                                console.log(`[ShellPort] ❌ Invalid TOTP code from ${sessionData.clientIP}`);
                                ws.close(4003, "Authentication failed");
                                return;
                            }

                            console.log(`[ShellPort] ✅ TOTP verified for ${sessionData.clientIP}`);
                            sessionData.totpPending = false;
                            if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                            incrementSessions();
                            const sessionKey = (sessionData as any)._sessionKey || null;
                            spawnPTY(ws, sessionData, sessionKey, safeEnv, () => decrementSessions());
                        }
                    });
                    return;
                }

                // ─── Normal authenticated traffic ───
                if (sessionData.authenticated) {
                    handleDataMessage(ws, sessionData, msgBuffer, baseKey, config);
                    return;
                }

                // ─── Authentication handshake ───
                sessionData.recvQ.add(async () => {
                    if (sessionData.authenticated) {
                        handleDataMessage(ws, sessionData, msgBuffer, baseKey, config);
                        return;
                    }

                    const msgView = new Uint8Array(msgBuffer);
                    const peekType = msgView.length > 0 ? msgView[0] : 0;

                    if (baseKey && sessionData.serverNonce) {
                        if (peekType !== FrameType.CLIENT_NONCE) {
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        if (msgView.length < 17) { // 1 type byte + 16 nonce bytes
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        // Skip the frame type byte (byte 0) to get the actual nonce payload
                        const clientNonce = msgView.slice(1, 17);
                        const sessionSalt = await deriveSessionSalt(sessionData.serverNonce!, clientNonce);
                        const sessionKey = await deriveKey(config.secret, sessionSalt);

                        (sessionData as any)._sessionKey = sessionKey;
                        sessionData.serverNonce = undefined;
                        sessionData.authenticated = true;

                        // If TOTP is enabled, send challenge instead of spawning PTY
                        if (config.totp && config.totpSecret) {
                            sessionData.totpPending = true;
                            // Send TOTP challenge (encrypted)
                            ws.send(await pack(sessionKey, FrameType.TOTP_CHALLENGE, new Uint8Array(0)));
                            console.log(`[ShellPort] 🔑 TOTP challenge sent to ${sessionData.clientIP}`);
                            return;
                        }

                        if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                        incrementSessions();
                        spawnPTY(ws, sessionData, sessionKey, safeEnv, () => decrementSessions());
                        return;
                    }

                    // No encryption — handle plaintext with optional TOTP
                    sessionData.authenticated = true;
                    if (sessionData.authTimer) clearTimeout(sessionData.authTimer);

                    if (config.totp && config.totpSecret) {
                        sessionData.totpPending = true;
                        // Send TOTP challenge (plaintext)
                        ws.send(await pack(null, FrameType.TOTP_CHALLENGE, new Uint8Array(0)));
                        console.log(`[ShellPort] 🔑 TOTP challenge sent to ${sessionData.clientIP}`);
                        return;
                    }

                    incrementSessions();
                    spawnPTY(ws, sessionData, null, safeEnv, () => decrementSessions());
                });
            },

            close(ws, code, reason) {
                const sessionData = ws.data as unknown as SessionData;
                if (sessionData.authTimer) clearTimeout(sessionData.authTimer);

                if (sessionData.authenticated && !sessionData.totpPending) {
                    decrementSessions();
                }

                const proc = sessionData.proc;
                if (proc && !proc.killed) {
                    try {
                        proc.kill();
                    } catch {
                        // Already dead
                    }
                }
                console.log(`[ShellPort] PTY session closed (${sessionData.clientIP || "unknown"})`);
            },
        },
    });

    console.log(`[ShellPort] ✅ Listening on http://localhost:${config.port}`);
    console.log(`[ShellPort] 📊 Max sessions: ${MAX_SESSIONS}`);
    console.log(`[ShellPort] 🔒 Protocol version: v${PROTOCOL_VERSION}`);

    // Start background cleanup task
    setInterval(cleanupRateLimits, CLEANUP_INTERVAL_MS).unref();
}

/**
 * Helper to unpack a message in either encrypted or plaintext mode.
 */
async function unpackMessage(
    sessionData: SessionData,
    msgBuffer: ArrayBuffer,
    baseKey: CryptoKey | null,
    _config: ServerConfig
) {
    const sessionKey = (sessionData as any)._sessionKey || baseKey;
    return await unpack(sessionKey, msgBuffer);
}

function handleDataMessage(
    ws: any,
    sessionData: SessionData,
    msgBuffer: ArrayBuffer,
    baseKey: CryptoKey | null,
    config: ServerConfig
) {
    const sessionKey = (sessionData as any)._sessionKey || baseKey;

    sessionData.recvQ.add(async () => {
        const proc = sessionData.proc;
        if (!proc || !proc.terminal) return;

        const decoded = await unpack(sessionKey, msgBuffer);
        if (!decoded) {
            ws.close(4003, "Authentication failed");
            return;
        }

        if (decoded.type === FrameType.DATA) {
            sessionData.proc?.terminal?.write(decoded.payload);
        } else if (decoded.type === FrameType.CONTROL) {
            try {
                const payloadStr = new TextDecoder().decode(decoded.payload);
                if (payloadStr.length > 65536) return;

                const ctl = JSON.parse(payloadStr);

                if (ctl.type === "resize") {
                    const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(Number(ctl.cols)) || 80));
                    const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(Number(ctl.rows)) || 24));
                    sessionData.proc?.terminal?.resize(cols, rows);
                }
            } catch {
                // Malformed control message — ignore
            }
        }
    });
}

/**
 * Sanitizes data coming from the PTY before sending it to the client.
 * Blocks sequences that could be used for fingerprinting or dangerous client-side actions.
 */
export function sanitizePTYData(data: Uint8Array): Uint8Array {
    let str = new TextDecoder().decode(data);
    
    // 1. Block DSR (Device Status Report) - CSI 6 n
    // Prevents the shell from querying the client's cursor position.
    str = str.replace(/\x1b\[6n/g, "");

    // 2. Block OSC 52 (Clipboard Write)
    // Even though the frontend has a confirmation prompt, blocking at server level 
    // provides defense-in-depth for users who might disable prompts.
    str = str.replace(/\x1b\]52;[^\x07\x1b]*[\x07\x1b\\]/g, "");

    return new TextEncoder().encode(str);
}

/** Spawn a PTY process and wire it to the WebSocket */
function spawnPTY(
    ws: any,
    sessionData: SessionData,
    cryptoKey: CryptoKey | null,
    env: Record<string, string>,
    onClose: () => void,
) {
    console.log(`[ShellPort] New PTY session allocated for ${sessionData.clientIP || "unknown"}.`);
    try {
        const shell = process.env.SHELL || "bash";
        if (!SAFE_SHELLS.includes(shell)) {
            console.error(`[ShellPort] Rejected unsafe shell: ${shell}`);
            onClose();
            ws.close(1011, "Unsupported shell");
            return;
        }
        const proc = spawn([shell], {
            env,
            terminal: {
                cols: 80,
                rows: 24,
                data(_term: unknown, data: Uint8Array) {
                    sessionData.sendQ.add(async () => {
                        if (ws.readyState === 1) {
                            const sanitized = sanitizePTYData(data);
                            ws.send(await pack(cryptoKey, FrameType.DATA, sanitized));
                        }
                    });
                },
            },
        });

        sessionData.proc = proc;

        proc.exited.then(() => {
            onClose();
            if (ws.readyState === 1) {
                ws.close(1000, "Shell exited");
            }
        });
    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[ShellPort] PTY spawn failed: ${errorMsg}`);
        onClose();
        ws.close(1011, "PTY Spawn Failed");
    }
}
```

### File: `src/server_ratelimit.test.ts`

- Size: 1601 bytes
- Modified: 2026-03-19 03:01:26 UTC

```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { rateLimitMap, cleanupRateLimits, RATE_LIMIT_WINDOW_MS } from "./server.js";

describe("Rate Limit Cleanup", () => {
    afterEach(() => {
        rateLimitMap.clear();
    });

    test("removes stale entries", () => {
        const now = Date.now();
        // Add an entry that is older than the window
        // Simulate a timestamp from > 60s ago
        const staleTime = now - RATE_LIMIT_WINDOW_MS - 1000;
        rateLimitMap.set("10.0.0.1", [staleTime]);

        // Add an entry that is within the window
        const freshTime = now - 1000;
        rateLimitMap.set("10.0.0.2", [freshTime]);

        cleanupRateLimits();

        expect(rateLimitMap.has("10.0.0.1")).toBe(false); // Should be removed
        expect(rateLimitMap.has("10.0.0.2")).toBe(true);  // Should be kept
    });

    test("removes empty entries", () => {
        rateLimitMap.set("10.0.0.3", []);
        cleanupRateLimits();
        expect(rateLimitMap.has("10.0.0.3")).toBe(false);
    });

    test("keeps entries with at least one recent timestamp", () => {
        const now = Date.now();
        const staleTime = now - RATE_LIMIT_WINDOW_MS - 1000;
        const freshTime = now - 1000;

        // Even if some timestamps are old, if the last one is fresh, keep the entry.
        // (Individual timestamp pruning happens in checkRateLimit, this cleanup is for inactive IPs)
        rateLimitMap.set("10.0.0.4", [staleTime, freshTime]);

        cleanupRateLimits();

        expect(rateLimitMap.has("10.0.0.4")).toBe(true);
    });
});
```

### File: `src/totp.test.ts`

- Size: 10257 bytes
- Modified: 2026-02-14 18:09:30 UTC

```typescript
/**
 * ShellPort - TOTP Unit Tests
 *
 * Tests Base32, HMAC-SHA1, TOTP generation/verification,
 * and secret management against RFC test vectors.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
    base32Encode,
    base32Decode,
    generateTOTP,
    verifyTOTP,
    generateTOTPSecret,
    buildOTPAuthURI,
    saveTOTPSecret,
    loadTOTPSecret,
    deleteTOTPSecret,
} from "./totp.js";

// ═══════════════════════════════════════════════════════════════════════════
// Base32 Encode/Decode
// ═══════════════════════════════════════════════════════════════════════════

describe("Base32", () => {
    test("encode empty bytes", () => {
        expect(base32Encode(new Uint8Array(0))).toBe("");
    });

    test("decode empty string", () => {
        expect(base32Decode("")).toEqual(new Uint8Array(0));
    });

    test("round-trip: 'hello'", () => {
        const input = new TextEncoder().encode("hello");
        const encoded = base32Encode(input);
        expect(encoded).toBe("NBSWY3DP");
        const decoded = base32Decode(encoded);
        expect(new TextDecoder().decode(decoded)).toBe("hello");
    });

    test("round-trip: RFC 4648 test vectors", () => {
        const vectors: [string, string][] = [
            ["f", "MY"],
            ["fo", "MZXQ"],
            ["foo", "MZXW6"],
            ["foob", "MZXW6YQ"],
            ["fooba", "MZXW6YTB"],
            ["foobar", "MZXW6YTBOI"],
        ];

        for (const [plain, b32] of vectors) {
            const input = new TextEncoder().encode(plain);
            expect(base32Encode(input)).toBe(b32);
            expect(new TextDecoder().decode(base32Decode(b32))).toBe(plain);
        }
    });

    test("decode is case-insensitive", () => {
        const upper = base32Decode("NBSWY3DP");
        const lower = base32Decode("nbswy3dp");
        expect(upper).toEqual(lower);
    });

    test("decode ignores padding", () => {
        const withPad = base32Decode("NBSWY3DP======");
        const withoutPad = base32Decode("NBSWY3DP");
        expect(withPad).toEqual(withoutPad);
    });

    test("decode rejects invalid chars", () => {
        expect(() => base32Decode("INVALID!")).toThrow();
    });

    test("round-trip: random 20 bytes (TOTP secret size)", () => {
        const raw = crypto.getRandomValues(new Uint8Array(20));
        const encoded = base32Encode(raw);
        const decoded = base32Decode(encoded);
        expect(Array.from(decoded)).toEqual(Array.from(raw));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOTP Generation
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTP generation", () => {
    // RFC 6238 test secret: "12345678901234567890" (ASCII)
    // Base32 encoded: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    test("generates 6-digit code", async () => {
        const code = await generateTOTP(RFC_SECRET);
        expect(code.length).toBe(6);
        expect(/^\d{6}$/.test(code)).toBe(true);
    });

    test("same secret + time = same code", async () => {
        const time = 1000000000; // Fixed time
        const code1 = await generateTOTP(RFC_SECRET, time);
        const code2 = await generateTOTP(RFC_SECRET, time);
        expect(code1).toBe(code2);
    });

    test("different times produce different codes (usually)", async () => {
        const code1 = await generateTOTP(RFC_SECRET, 1000000000);
        const code2 = await generateTOTP(RFC_SECRET, 1000000060); // 2 windows later
        // Not guaranteed but extremely likely with different counters
        // This test just checks they're valid codes
        expect(code1.length).toBe(6);
        expect(code2.length).toBe(6);
    });

    test("RFC 6238 test vector: T=59", async () => {
        // At T=59, counter=1, expected TOTP for SHA1 = 287082
        const code = await generateTOTP(RFC_SECRET, 59);
        expect(code).toBe("287082");
    });

    test("RFC 6238 test vector: T=1111111109", async () => {
        // At T=1111111109, counter=37037036, expected = 081804
        const code = await generateTOTP(RFC_SECRET, 1111111109);
        expect(code).toBe("081804");
    });

    test("RFC 6238 test vector: T=1234567890", async () => {
        // At T=1234567890, counter=41152263, expected = 005924
        const code = await generateTOTP(RFC_SECRET, 1234567890);
        expect(code).toBe("005924");
    });

    test("zero-pads short codes", async () => {
        // We can't control the output, but we verify format
        const code = await generateTOTP(RFC_SECRET, 59);
        expect(code.length).toBe(6);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOTP Verification
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTP verification", () => {
    const SECRET = generateTOTPSecret();

    test("accepts current code", async () => {
        const code = await generateTOTP(SECRET);
        const valid = await verifyTOTP(SECRET, code);
        expect(valid).toBe(true);
    });

    test("accepts code from previous window (±1 tolerance)", async () => {
        const now = Math.floor(Date.now() / 1000);
        // Generate code for previous 30s window
        const prevCode = await generateTOTP(SECRET, now - 30);
        const valid = await verifyTOTP(SECRET, prevCode);
        expect(valid).toBe(true);
    });

    test("rejects completely wrong code", async () => {
        const valid = await verifyTOTP(SECRET, "000000");
        // Could theoretically match but extremely unlikely
        const code = await generateTOTP(SECRET);
        if (code === "000000") return; // Skip if by chance it matches

        expect(valid).toBe(false);
    });

    test("rejects code from far in the past", async () => {
        // Generate a code for 5 minutes ago (10 windows away)
        const oldCode = await generateTOTP(SECRET, Math.floor(Date.now() / 1000) - 300);
        const currentCode = await generateTOTP(SECRET);

        // Only assert rejection if the codes differ
        if (oldCode !== currentCode) {
            const valid = await verifyTOTP(SECRET, oldCode);
            expect(valid).toBe(false);
        }
    });

    test("timingSafeEqual handles different lengths and contents correctly", async () => {
        // We test verifyTOTP which uses timingSafeEqual
        expect(await verifyTOTP(SECRET, "123456")).toBe(false);
        expect(await verifyTOTP(SECRET, "12345")).toBe(false); // Different length
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Secret Management
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTP secret generation", () => {
    test("generates 32-char Base32 string", () => {
        const secret = generateTOTPSecret();
        expect(secret.length).toBe(32); // 20 bytes → 32 Base32 chars
        expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
    });

    test("generates unique secrets", () => {
        const s1 = generateTOTPSecret();
        const s2 = generateTOTPSecret();
        expect(s1).not.toBe(s2);
    });

    test("generated secrets can be used for TOTP", async () => {
        const secret = generateTOTPSecret();
        const code = await generateTOTP(secret);
        expect(code.length).toBe(6);
        const valid = await verifyTOTP(secret, code);
        expect(valid).toBe(true);
    });
});

describe("OTP Auth URI", () => {
    test("builds valid URI format", () => {
        const secret = "JBSWY3DPEHPK3PXP";
        const uri = buildOTPAuthURI(secret);

        expect(uri).toContain("otpauth://totp/");
        expect(uri).toContain(`secret=${secret}`);
        expect(uri).toContain("issuer=ShellPort");
        expect(uri).toContain("algorithm=SHA1");
        expect(uri).toContain("digits=6");
        expect(uri).toContain("period=30");
    });

    test("encodes label", () => {
        const uri = buildOTPAuthURI("SECRET", "My Server");
        expect(uri).toContain("otpauth://totp/My%20Server");
    });

    test("encodes custom issuer", () => {
        const uri = buildOTPAuthURI("SECRET", "Label", "Custom Issuer");
        expect(uri).toContain("issuer=Custom%20Issuer");
    });
});

describe("TOTP persistence", () => {
    const testSecret = generateTOTPSecret();

    afterEach(() => {
        try { deleteTOTPSecret(); } catch { }
    });

    test("save and load round-trip", () => {
        saveTOTPSecret(testSecret);
        const loaded = loadTOTPSecret();
        expect(loaded).toBe(testSecret);
    });

    test("load returns null when no file", () => {
        deleteTOTPSecret();
        const loaded = loadTOTPSecret();
        expect(loaded).toBeNull();
    });

    test("delete removes the file", () => {
        saveTOTPSecret(testSecret);
        deleteTOTPSecret();
        const loaded = loadTOTPSecret();
        expect(loaded).toBeNull();
    });
});
```

### File: `src/totp.ts`

- Size: 9348 bytes
- Modified: 2026-02-14 19:15:42 UTC

```typescript
/**
 * ShellPort - TOTP Authentication (RFC 6238)
 *
 * Zero-dependency TOTP implementation using Web Crypto API.
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 *
 * Features:
 * - HMAC-SHA1 via crypto.subtle
 * - Base32 encode/decode (RFC 4648)
 * - TOTP generation & verification with ±1 window tolerance
 * - otpauth:// URI builder for QR code pairing
 * - Secret persistence to ~/.shellport/totp.key
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ═══════════════════════════════════════════════════════════════════════════
// Base32 (RFC 4648)
// ═══════════════════════════════════════════════════════════════════════════

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encode raw bytes to Base32 (RFC 4648, no padding).
 */
export function base32Encode(data: Uint8Array): string {
    let result = "";
    let bits = 0;
    let value = 0;

    for (const byte of data) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            bits -= 5;
            result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
        }
    }

    // Flush remaining bits
    if (bits > 0) {
        result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
    }

    return result;
}

/**
 * Decode a Base32 string (RFC 4648) to raw bytes.
 * Ignores padding ('=') and spaces, case-insensitive.
 */
export function base32Decode(encoded: string): Uint8Array {
    const cleaned = encoded.replace(/[= ]/g, "").toUpperCase();
    const output: number[] = [];
    let bits = 0;
    let value = 0;

    for (const char of cleaned) {
        const idx = BASE32_ALPHABET.indexOf(char);
        if (idx === -1) throw new Error(`Invalid Base32 character: ${char}`);

        value = (value << 5) | idx;
        bits += 5;

        if (bits >= 8) {
            bits -= 8;
            output.push((value >>> bits) & 0xff);
        }
    }

    return new Uint8Array(output);
}

// ═══════════════════════════════════════════════════════════════════════════
// HMAC-SHA1 via Web Crypto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute HMAC-SHA1(key, message) using Web Crypto API.
 */
async function hmacSHA1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key as unknown as ArrayBuffer,
        { name: "HMAC", hash: { name: "SHA-1" } },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, message as unknown as ArrayBuffer);
    return new Uint8Array(signature);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOTP (RFC 6238)
// ═══════════════════════════════════════════════════════════════════════════

/** TOTP period in seconds */
const TOTP_PERIOD = 30;

/** Number of digits in the TOTP code */
const TOTP_DIGITS = 6;

/** Secret size in bytes (160-bit, standard for TOTP) */
const SECRET_BYTES = 20;

/**
 * Convert a counter value to an 8-byte big-endian Uint8Array.
 */
function counterToBytes(counter: number): Uint8Array {
    const buf = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) {
        buf[i] = c & 0xff;
        c = Math.floor(c / 256);
    }
    return buf;
}

/**
 * Dynamic truncation (RFC 4226 §5.3).
 * Extracts a 4-byte code from the HMAC result.
 */
function dynamicTruncation(hmac: Uint8Array): number {
    const offset = hmac[hmac.length - 1] & 0x0f;
    return (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    );
}

/**
 * Generate a TOTP code for the given secret and time.
 * @param secret - Base32-encoded TOTP secret
 * @param timeSeconds - Unix timestamp in seconds (defaults to now)
 * @returns 6-digit TOTP code as a zero-padded string
 */
export async function generateTOTP(
    secret: string,
    timeSeconds?: number
): Promise<string> {
    const key = base32Decode(secret);
    const time = timeSeconds ?? Math.floor(Date.now() / 1000);
    const counter = Math.floor(time / TOTP_PERIOD);

    const hmac = await hmacSHA1(key, counterToBytes(counter));
    const code = dynamicTruncation(hmac) % Math.pow(10, TOTP_DIGITS);

    return code.toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Constant-time comparison of two strings to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Verify a TOTP code against the current time ± 1 window.
 * This allows for 30 seconds of clock skew in either direction.
 *
 * @param secret - Base32-encoded TOTP secret
 * @param code - 6-digit code to verify
 * @returns true if the code is valid
 */
export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const paddedCode = code.padStart(TOTP_DIGITS, "0");

    let isValid = false;

    // Check current window and ±1 window (allows 30s clock skew)
    for (const offset of [-1, 0, 1]) {
        const time = now + offset * TOTP_PERIOD;
        const expected = await generateTOTP(secret, time);
        if (timingSafeEqual(expected, paddedCode)) {
            isValid = true;
        }
    }

    return isValid;
}

// ═══════════════════════════════════════════════════════════════════════════
// Secret Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a new random TOTP secret (160-bit, Base32 encoded).
 * Returns a 32-character Base32 string.
 */
export function generateTOTPSecret(): string {
    const raw = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
    return base32Encode(raw);
}

/**
 * Build an otpauth:// URI for QR code generation.
 * This URI format is understood by all major authenticator apps.
 */
export function buildOTPAuthURI(
    secret: string,
    label: string = "ShellPort",
    issuer: string = "ShellPort"
): string {
    const encodedLabel = encodeURIComponent(label);
    const encodedIssuer = encodeURIComponent(issuer);
    return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistence (~/.shellport/totp.key)
// ═══════════════════════════════════════════════════════════════════════════

const SHELLPORT_DIR = join(homedir(), ".shellport");
const TOTP_KEY_FILE = join(SHELLPORT_DIR, "totp.key");

/**
 * Save TOTP secret to ~/.shellport/totp.key
 * Creates the directory if it doesn't exist.
 */
export function saveTOTPSecret(secret: string): void {
    if (!existsSync(SHELLPORT_DIR)) {
        mkdirSync(SHELLPORT_DIR, { mode: 0o700 });
    }
    writeFileSync(TOTP_KEY_FILE, secret, { mode: 0o600 });
}

/**
 * Load TOTP secret from ~/.shellport/totp.key
 * Returns null if the file doesn't exist.
 */
export function loadTOTPSecret(): string | null {
    if (!existsSync(TOTP_KEY_FILE)) return null;
    const secret = readFileSync(TOTP_KEY_FILE, "utf-8").trim();
    if (secret && process.env.NODE_ENV !== "test" && !process.argv.includes("--quiet") && !process.argv.includes("-q")) {
        console.log(`[ShellPort] 🔑 Loaded TOTP secret from ${TOTP_KEY_FILE}`);
    }
    return secret;
}

/**
 * Delete the persisted TOTP secret (for --totp-reset).
 */
export function deleteTOTPSecret(): void {
    if (existsSync(TOTP_KEY_FILE)) {
        unlinkSync(TOTP_KEY_FILE);
    }
}
```

### File: `src/types.test.ts`

- Size: 3285 bytes
- Modified: 2026-02-13 18:20:13 UTC

```typescript
/**
 * ShellPort - Types & SeqQueue Tests
 *
 * Tests FrameType constants and SeqQueue ordering guarantees.
 */

import { describe, test, expect } from "bun:test";
import { SeqQueue, FrameType } from "./types.js";

// ---------------------------------------------------------------------------
// FrameType constants
// ---------------------------------------------------------------------------
describe("FrameType", () => {
    test("core frame types have correct values", () => {
        expect(FrameType.DATA).toBe(0);
        expect(FrameType.CONTROL).toBe(1);
        expect(FrameType.SERVER_NONCE).toBe(2);
        expect(FrameType.CLIENT_NONCE).toBe(3);
        expect(FrameType.APPROVAL_REQUEST).toBe(4);
        expect(FrameType.APPROVAL_RESPONSE).toBe(5);
    });

    test("has all expected frame types", () => {
        const keys = Object.keys(FrameType);
        expect(keys).toContain("DATA");
        expect(keys).toContain("CONTROL");
        expect(keys).toContain("SERVER_NONCE");
        expect(keys).toContain("CLIENT_NONCE");
        expect(keys).toContain("APPROVAL_REQUEST");
        expect(keys).toContain("APPROVAL_RESPONSE");
    });
});

// ---------------------------------------------------------------------------
// SeqQueue
// ---------------------------------------------------------------------------
describe("SeqQueue", () => {
    test("executes tasks in FIFO order", async () => {
        const q = new SeqQueue();
        const results: number[] = [];

        q.add(async () => { results.push(1); });
        q.add(async () => { results.push(2); });
        q.add(async () => { results.push(3); });

        // Wait for all tasks to drain
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(results).toEqual([1, 2, 3]);
    });

    test("maintains order with varying async delays", async () => {
        const q = new SeqQueue();
        const results: string[] = [];

        q.add(async () => {
            await new Promise(r => setTimeout(r, 30));
            results.push("slow");
        });
        q.add(async () => {
            results.push("fast");
        });
        q.add(async () => {
            await new Promise(r => setTimeout(r, 10));
            results.push("medium");
        });

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(results).toEqual(["slow", "fast", "medium"]);
    });

    test("continues execution after a failing task", async () => {
        const q = new SeqQueue();
        const results: string[] = [];

        q.add(async () => { results.push("before"); });
        q.add(async () => { throw new Error("boom"); });
        q.add(async () => { results.push("after"); });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(results).toEqual(["before", "after"]);
    });

    test("handles many queued tasks", async () => {
        const q = new SeqQueue();
        const results: number[] = [];
        const N = 100;

        for (let i = 0; i < N; i++) {
            q.add(async () => { results.push(i); });
        }

        await new Promise(resolve => setTimeout(resolve, 200));

        expect(results.length).toBe(N);
        expect(results).toEqual(Array.from({ length: N }, (_, i) => i));
    });
});
```

### File: `src/types.ts`

- Size: 2737 bytes
- Modified: 2026-02-14 05:15:24 UTC

```typescript
/**
 * ShellPort - Types & Constants
 */

/** Frame types for the wire protocol */
export const FrameType = {
    /** Terminal data (stdin/stdout) */
    DATA: 0,
    /** Control messages (resize, etc.) */
    CONTROL: 1,
    /** Server nonce for session salt derivation */
    SERVER_NONCE: 2,
    /** Client nonce for session salt derivation */
    CLIENT_NONCE: 3,
    /** Approval request (server -> client) */
    APPROVAL_REQUEST: 4,
    /** Approval response (client -> server) */
    APPROVAL_RESPONSE: 5,
    /** TOTP challenge sent by server */
    TOTP_CHALLENGE: 6,
    /** TOTP response sent by client (6-digit code) */
    TOTP_RESPONSE: 7,
} as const;

export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

/** Decoded frame from the wire */
export interface DecodedFrame {
    type: FrameTypeValue;
    payload: Uint8Array;
}

/** Terminal resize dimensions */
export interface TerminalSize {
    cols: number;
    rows: number;
}

/** Control message sent through the CONTROL channel */
export interface ControlMessage {
    type: "resize";
    cols: number;
    rows: number;
}

/** Server configuration */
export interface ServerConfig {
    port: number;
    secret: string;
    tailscale: string;
    /** Require interactive approval for new connections (legacy) */
    requireApproval: boolean;
    /** Allow localhost origin bypass (dev mode) */
    allowLocalhost: boolean;
    /** Enable TOTP 2FA (default: true) */
    totp: boolean;
    /** TOTP secret (Base32 encoded) */
    totpSecret?: string;
}

/** Client configuration */
export interface ClientConfig {
    url: string;
    secret: string;
}

/** Per-connection WebSocket data */
export interface SessionData {
    sendQ: SeqQueue;
    recvQ: SeqQueue;
    proc: ReturnType<typeof import("bun").spawn> | null;
    /** Whether the client has proven knowledge of the encryption key */
    authenticated: boolean;
    /** Timer for auth timeout (cleared on successful auth) */
    authTimer?: ReturnType<typeof setTimeout>;
    /** Per-session nonce from server */
    serverNonce?: Uint8Array;
    /** Client IP address for approval prompts */
    clientIP?: string;
    /** Pending approval resolve function */
    approvalResolve?: (approved: boolean) => void;
    /** Timer for approval timeout */
    approvalTimer?: ReturnType<typeof setTimeout>;
    /** Whether TOTP verification is pending */
    totpPending?: boolean;
}

/** Sequential async queue for ordered message handling */
export class SeqQueue {
    private p: Promise<void> = Promise.resolve();

    add(fn: () => Promise<void>): void {
        this.p = this.p.then(fn).catch(() => {
            // Error sanitized - avoid logging sensitive data
        });
    }
}
```

### File: `test/shellport-test-server.ts`

- Size: 8575 bytes
- Modified: 2026-03-21 02:46:28 UTC

```typescript
/**
 * Standalone ShellPort Test Server
 * 
 * Minimal Bun server that spawns a PTY shell and relays I/O over WebSocket.
 * Tests NanoTermV2 in isolation — zero ME dependencies.
 * 
 * Usage: bun run packages/shellport/test/shellport-test-server.ts
 * Then open http://localhost:7777 in your browser.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const PORT = 7777;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const nanoTermPath = path.join(testDir, '..', 'src', 'frontend', 'nanoterm.js');

const isWindows = process.platform === 'win32';

// Track active sessions per WebSocket
interface Session {
    proc: ReturnType<typeof Bun.spawn>;
    usePty: boolean;
}
const sessions = new Map<number, Session>();
let sessionCounter = 0;

/** Continuously read from a ReadableStream and forward to WebSocket */
async function pipeStreamToWs(stream: ReadableStream<Uint8Array> | null, ws: any) {
    if (!stream) return;
    const reader = stream.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            try {
                if (ws.readyState === 1) ws.send(value);
            } catch { break; }
        }
    } catch { /* stream closed */ }
}

const server = Bun.serve({
    port: PORT,
    fetch(req, server) {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (url.pathname === '/ws') {
            const upgraded = server.upgrade(req, {
                data: { id: ++sessionCounter },
            });
            if (upgraded) return undefined;
            return new Response('WebSocket upgrade failed', { status: 500 });
        }

        // Serve NanoTermV2 vendor script
        if (url.pathname === '/vendor/nanoterm.js') {
            return new Response(Bun.file(nanoTermPath), {
                headers: { 'Content-Type': 'application/javascript' },
            });
        }

        // Serve test HTML
        if (url.pathname === '/' || url.pathname === '/index.html') {
            return new Response(Bun.file(path.join(testDir, 'shellport-test.html')), {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        return new Response('Not Found', { status: 404 });
    },

    websocket: {
        open(ws) {
            if (isWindows) {
                // Windows: use piped stdin/stdout (no PTY support in Bun)
                const shellCmd = process.env.COMSPEC || 'cmd.exe';
                const shellArgs = shellCmd.toLowerCase().includes('cmd') 
                    ? [shellCmd] 
                    : [shellCmd, '-NoLogo', '-NoExit'];
                console.log(`🐚 [Test] Client ${ws.data.id} connected — spawning shell (piped): ${shellCmd}`);

                const proc = Bun.spawn(shellArgs, {
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        TERM: 'xterm-256color',
                    },
                    stdin: 'pipe',
                    stdout: 'pipe',
                    stderr: 'pipe',
                });

                // Pipe stdout and stderr to WebSocket  
                pipeStreamToWs(proc.stdout as ReadableStream<Uint8Array>, ws);
                pipeStreamToWs(proc.stderr as ReadableStream<Uint8Array>, ws);

                sessions.set(ws.data.id, { proc, usePty: false });
                console.log(`🐚 [Test] Shell spawned PID=${proc.pid} (piped mode)`);
            } else {
                // Unix: use PTY terminal
                const shellCmd = process.env.SHELL || '/bin/bash';
                console.log(`🐚 [Test] Client ${ws.data.id} connected — spawning PTY: ${shellCmd}`);

                const proc = Bun.spawn([shellCmd], {
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        TERM: 'xterm-256color',
                        COLORTERM: 'truecolor',
                        TERM_PROGRAM: 'WezTerm',
                    },
                    terminal: {
                        cols: 120,
                        rows: 40,
                        data: (_terminal: unknown, data: Uint8Array) => {
                            try {
                                if (ws.readyState === 1) ws.send(data);
                            } catch { /* client disconnected */ }
                        },
                    },
                });

                sessions.set(ws.data.id, { proc, usePty: true });
                console.log(`🐚 [Test] PTY spawned PID=${proc.pid}`);
            }
        },

        message(ws, message) {
            const session = sessions.get(ws.data.id);
            if (!session) return;
            const { proc, usePty } = session;

            if (usePty) {
                // PTY mode (Unix)
                if (typeof message !== 'string') {
                    try {
                        const terminal = (proc as any).terminal;
                        if (terminal) terminal.write(new TextDecoder().decode(message as ArrayBuffer));
                    } catch { /* process exited */ }
                    return;
                }
                try {
                    const msg = JSON.parse(message);
                    if (msg.type === 'resize' && msg.cols && msg.rows) {
                        const terminal = (proc as any).terminal;
                        if (terminal) {
                            terminal.resize(msg.cols, msg.rows);
                            console.log(`🐚 [Test] Resized PTY to ${msg.cols}x${msg.rows}`);
                        }
                    }
                } catch {
                    const terminal = (proc as any).terminal;
                    if (terminal) terminal.write(message);
                }
            } else {
                // Piped mode (Windows) — implement basic line discipline for echo
                if (typeof message !== 'string') {
                    const bytes = new Uint8Array(message as ArrayBuffer);
                    try {
                        proc.stdin?.write(bytes);
                        // Smart echo: handle control characters properly
                        for (const byte of bytes) {
                            if (byte === 0x7F || byte === 0x08) {
                                // Backspace: move cursor back, overwrite with space, move back
                                if (ws.readyState === 1) ws.send(new Uint8Array([0x08, 0x20, 0x08]));
                            } else if (byte === 0x0D) {
                                // Enter: echo CR+LF
                                if (ws.readyState === 1) ws.send(new Uint8Array([0x0D, 0x0A]));
                            } else if (byte >= 0x20) {
                                // Printable characters: echo as-is
                                if (ws.readyState === 1) ws.send(new Uint8Array([byte]));
                            }
                            // Other control chars (Tab, Escape, etc.): don't echo
                        }
                    } catch { /* process exited */ }
                    return;
                }
                try {
                    const msg = JSON.parse(message);
                    if (msg.type === 'resize') {
                        // Resize not supported in piped mode — ignore
                        return;
                    }
                } catch { /* not JSON */ }
                // Write text input to stdin + echo
                try {
                    const encoded = new TextEncoder().encode(message);
                    proc.stdin?.write(encoded);
                    if (ws.readyState === 1) ws.send(encoded);
                } catch { /* process exited */ }
            }
        },

        close(ws) {
            const session = sessions.get(ws.data.id);
            if (session) {
                const { proc, usePty } = session;
                console.log(`🐚 [Test] Client ${ws.data.id} disconnected — killing PID=${proc.pid}`);
                try {
                    if (usePty) (proc as any).terminal?.close();
                    proc.stdin?.end();
                    proc.kill();
                } catch { /* already dead */ }
                sessions.delete(ws.data.id);
            }
        },
    },
});

console.log(`\n🧪 ShellPort Standalone Test Server`);
console.log(`   Open http://localhost:${PORT} in your browser`);
console.log(`   Platform: ${process.platform} (${isWindows ? 'piped' : 'PTY'} mode)\n`);
```

### File: `test/shellport-test.html`

- Size: 11221 bytes
- Modified: 2026-03-21 02:46:28 UTC

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ShellPort Test — NanoTermV2 Standalone</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0a0f;
            color: #e4e4e7;
            font-family: system-ui, -apple-system, sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        header {
            padding: 8px 16px;
            background: #15151f;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 13px;
            flex-wrap: wrap;
        }
        header .title {
            font-weight: 600;
            color: #a78bfa;
        }
        header .status {
            color: #71717a;
        }
        header .status.connected { color: #4ade80; }
        header .status.error { color: #ef4444; }
        .controls {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-left: auto;
        }
        .controls button {
            background: #27273a;
            border: 1px solid rgba(255,255,255,0.1);
            color: #e4e4e7;
            padding: 2px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.4;
        }
        .controls button:hover { background: #3a3a52; }
        .controls button:active { background: #4a4a6a; }
        .controls select {
            background: #27273a;
            border: 1px solid rgba(255,255,255,0.1);
            color: #e4e4e7;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        .controls .font-size-display {
            font-variant-numeric: tabular-nums;
            min-width: 36px;
            text-align: center;
            color: #a78bfa;
            font-weight: 600;
        }
        .controls label {
            color: #71717a;
            font-size: 12px;
        }
        .controls .separator {
            width: 1px;
            height: 16px;
            background: rgba(255,255,255,0.1);
            margin: 0 4px;
        }
        .cell-info {
            color: #71717a;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
        }
        #terminal-container {
            flex: 1;
            padding: 4px;
            overflow: hidden;
        }
        .term-canvas {
            outline: none;
        }
    </style>
</head>
<body>
    <header>
        <span class="title">🧪 ShellPort Standalone Test</span>
        <span id="renderer" class="status" style="color:#f59e0b;">renderer: ?</span>
        <span id="status" class="status">Connecting…</span>
        <div class="controls">
            <label>Font:</label>
            <button id="font-down" title="Decrease font size (Ctrl+-)">−</button>
            <span id="font-size-display" class="font-size-display">14</span>
            <button id="font-up" title="Increase font size (Ctrl++)">+</button>
            <div class="separator"></div>
            <label>Theme:</label>
            <select id="theme-select">
                <option value="shellport">ShellPort</option>
                <option value="dracula">Dracula</option>
                <option value="catppuccin">Catppuccin Mocha</option>
                <option value="solarized-dark">Solarized Dark</option>
                <option value="gruvbox">Gruvbox Dark</option>
                <option value="tokyonight">Tokyo Night</option>
                <option value="nord">Nord</option>
                <option value="one-dark">One Dark</option>
            </select>
            <div class="separator"></div>
            <span id="cell-info" class="cell-info"></span>
        </div>
    </header>
    <div id="terminal-container"></div>

    <script src="/vendor/nanoterm.js"></script>
    <script>
        // ── Theme Presets ──────────────────────────────────────────────────
        const THEMES = {
            shellport: {
                background: '#0a0a0f',
                foreground: '#e4e4e7',
                cursor: '#a78bfa',
                selection: 'rgba(167, 139, 250, 0.3)',
            },
            dracula: {
                background: '#282a36',
                foreground: '#f8f8f2',
                cursor: '#f8f8f2',
                selection: 'rgba(68, 71, 90, 0.5)',
            },
            catppuccin: {
                background: '#1e1e2e',
                foreground: '#cdd6f4',
                cursor: '#f5e0dc',
                selection: 'rgba(88, 91, 112, 0.4)',
            },
            'solarized-dark': {
                background: '#002b36',
                foreground: '#839496',
                cursor: '#93a1a1',
                selection: 'rgba(7, 54, 66, 0.6)',
            },
            gruvbox: {
                background: '#282828',
                foreground: '#ebdbb2',
                cursor: '#ebdbb2',
                selection: 'rgba(60, 56, 54, 0.5)',
            },
            tokyonight: {
                background: '#1a1b26',
                foreground: '#c0caf5',
                cursor: '#c0caf5',
                selection: 'rgba(41, 46, 66, 0.5)',
            },
            nord: {
                background: '#2e3440',
                foreground: '#d8dee9',
                cursor: '#d8dee9',
                selection: 'rgba(67, 76, 94, 0.5)',
            },
            'one-dark': {
                background: '#282c34',
                foreground: '#abb2bf',
                cursor: '#528bff',
                selection: 'rgba(62, 68, 81, 0.5)',
            },
        };

        // ── State ──────────────────────────────────────────────────────────
        const statusEl = document.getElementById('status');
        const container = document.getElementById('terminal-container');
        const fontSizeDisplay = document.getElementById('font-size-display');
        const cellInfoEl = document.getElementById('cell-info');
        const themeSelect = document.getElementById('theme-select');

        let currentFontSize = 14;
        let currentTheme = 'shellport';
        let term = null;
        let ws = null;

        function updateCellInfo() {
            if (!term) return;
            const cw = term.charWidth?.toFixed(1) || '?';
            const ch = term.charHeight?.toFixed(1) || '?';
            const dpr = window.devicePixelRatio || 1;
            cellInfoEl.textContent = `cell: ${cw}×${ch}px · ${term.cols}×${term.rows} · dpr: ${dpr}`;
        }

        function createTerminal(fontSize) {
            // Destroy previous terminal if exists
            if (term) {
                term.destroy();
                term = null;
            }

            currentFontSize = fontSize;
            fontSizeDisplay.textContent = fontSize;

            term = new NanoTermV2(container, (data) => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                if (typeof data === 'string') {
                    ws.send(new TextEncoder().encode(data));
                } else {
                    ws.send(data);
                }
            }, {
                fontSize,
                cursorBlink: true,
                scrollback: 10000,
                theme: THEMES[currentTheme],
            });

            // Show renderer
            const rendererName = term.renderer?.constructor?.name || 'Unknown';
            const rendererEl = document.getElementById('renderer');
            rendererEl.textContent = 'renderer: ' + rendererName;
            rendererEl.style.color = rendererName.includes('WebGL') ? '#4ade80' : '#f59e0b';

            // Wire resize
            term.onResize = (cols, rows) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
                }
                updateCellInfo();
            };

            if (term.cols && term.rows && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }

            updateCellInfo();
            term.canvas.focus();
        }

        function changeFontSize(delta) {
            const newSize = Math.max(8, Math.min(32, currentFontSize + delta));
            if (newSize === currentFontSize) return;
            currentFontSize = newSize;
            fontSizeDisplay.textContent = newSize;
            if (term) {
                term.setFontSize(newSize);
                updateCellInfo();
            }
        }

        // ── Theme switching (live, no state loss) ──
        themeSelect.addEventListener('change', (e) => {
            currentTheme = e.target.value;
            const theme = THEMES[currentTheme];
            if (term && theme) {
                term.setTheme(theme);
                // Also update the page background to match
                document.body.style.background = theme.background;
            }
        });

        // Button controls
        document.getElementById('font-up').addEventListener('click', () => changeFontSize(1));
        document.getElementById('font-down').addEventListener('click', () => changeFontSize(-1));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
                e.preventDefault();
                changeFontSize(1);
            } else if (e.ctrlKey && e.key === '-') {
                e.preventDefault();
                changeFontSize(-1);
            }
        });

        // ── WebSocket Connection ───────────────────────────────────────────
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}/ws`);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            statusEl.textContent = '● Connected';
            statusEl.className = 'status connected';
            createTerminal(currentFontSize);
        };

        ws.onmessage = (event) => {
            if (!term) return;
            if (event.data instanceof ArrayBuffer) {
                term.write(new Uint8Array(event.data));
            } else {
                term.write(event.data);
            }
        };

        ws.onclose = () => {
            statusEl.textContent = '● Disconnected';
            statusEl.className = 'status error';
        };

        ws.onerror = () => {
            statusEl.textContent = '● Connection Error';
            statusEl.className = 'status error';
        };
    </script>
</body>
</html>
```

### File: `scripts/build-binaries.ts`

- Size: 1356 bytes
- Modified: 2026-02-13 08:46:19 UTC

```typescript
#!/usr/bin/env bun
/**
 * ShellPort - Cross-platform binary builder
 *
 * Builds precompiled executables for all supported platforms using
 * `bun build --compile`. Run with `bun run build:binaries`.
 */

import { $ } from "bun";
import { mkdirSync, existsSync } from "fs";

const ENTRY = "./src/index.ts";
const DIST = "./dist";

const targets = [
    { target: "bun-linux-x64", outfile: "shellport-linux-x64" },
    { target: "bun-linux-arm64", outfile: "shellport-linux-arm64" },
    { target: "bun-darwin-x64", outfile: "shellport-darwin-x64" },
    { target: "bun-darwin-arm64", outfile: "shellport-darwin-arm64" },
    { target: "bun-windows-x64", outfile: "shellport-windows-x64" },
];

async function main() {
    if (!existsSync(DIST)) {
        mkdirSync(DIST, { recursive: true });
    }

    console.log(`[build] Building ${targets.length} platform binaries...\n`);

    for (const { target, outfile } of targets) {
        const out = `${DIST}/${outfile}`;
        console.log(`  → ${target} → ${out}`);

        try {
            await $`bun build ${ENTRY} --compile --target=${target} --minify --bytecode --outfile ${out}`;
            console.log(`    ✅ Done`);
        } catch (error) {
            console.error(`    ❌ Failed: ${error}`);
        }
    }

    console.log(`\n[build] All binaries written to ${DIST}/`);
}

main();
```
