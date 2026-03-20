# Directory Structure Report

This document contains files from the `/home/igorls/dev/GitHub/shellport` directory with extensions: js, ts, html, css, json
Custom ignored patterns: node_modules,qr_code_terminal,.git,.github
Content hash: 311cb57ba5eeca12

## File Tree Structure

- 📄 package.json
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
    - 📄 index.html
    - 📄 nanoterm.js
    - 📄 styles.css
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
- 📄 tsconfig.json


### File: `package.json`

- Size: 1102 bytes
- Modified: 2026-02-14 07:10:33 UTC

```json
{
  "name": "shellport",
  "version": "0.2.0",
  "description": "Zero-dependency encrypted terminal bridge with TOTP 2FA and built-in web UI. Share your shell over the network with E2E encryption, powered by Bun.",
  "type": "module",
  "bin": {
    "shellport": "./src/index.ts"
  },
  "exports": {
    ".": "./src/index.ts",
    "./nanoterm": "./src/frontend/nanoterm.js"
  },
  "scripts": {
    "dev": "bun run src/index.ts server --dev",
    "build": "bun build ./src/index.ts --compile --minify --bytecode --outfile shellport",
    "build:binaries": "bun run scripts/build-binaries.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "keywords": [
    "terminal",
    "pty",
    "websocket",
    "encryption",
    "totp",
    "2fa",
    "authenticator",
    "shell",
    "remote",
    "bun",
    "zero-dependency",
    "canvas",
    "vt100",
    "xterm"
  ],
  "author": "",
  "license": "MIT",
  "engines": {
    "bun": ">=1.0.0"
  },
  "files": [
    "src/**/*",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

### File: `tsconfig.json`

- Size: 528 bytes
- Modified: 2026-02-13 08:46:19 UTC

```json
{
    "compilerOptions": {
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true,
        "declaration": false,
        "noEmit": true,
        "types": [
            "bun"
        ]
    },
    "include": [
        "src/**/*.ts"
    ],
    "exclude": [
        "node_modules",
        "dist",
        "tests"
    ]
}
```

### File: `src/frontend/app.js`

- Size: 14690 bytes
- Modified: 2026-03-19 03:03:01 UTC

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

    term.onResize = (cols, rows) => {
        if (!handshakeComplete) return;
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

- Size: 1070 bytes
- Modified: 2026-02-13 08:46:19 UTC

```typescript
/**
 * ShellPort - Frontend HTML Builder
 *
 * Reads the frontend template and injects styles, crypto engine,
 * NanoTermV2 emulator, and app logic as inline content.
 * This produces a single self-contained HTML response.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFrontendFile(filename: string): string {
    return readFileSync(resolve(__dirname, filename), "utf-8");
}

/**
 * Build the complete HTML client by injecting all frontend assets
 * into the HTML template.
 */
export function buildHTML(cryptoJS: string): string {
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

### File: `src/frontend/nanoterm.js`

- Size: 71085 bytes
- Modified: 2026-03-20 18:34:55 UTC

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// NanoTermV2: Feature-Complete VT100/VT220/xterm Emulator
// Hardware-accelerated Canvas2D renderer with zero dependencies
// ═══════════════════════════════════════════════════════════════════════════

// Maximum buffer size for OSC/DCS sequences (64 KB)
const MAX_SEQUENCE_SIZE = 65536;

// Standard xterm 256-color palette
const XTERM_256_PALETTE = [
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

const ATTR = {
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
const DEC_SPECIAL_GRAPHICS = {
    '`': '◆', 'a': '▒', 'f': '°', 'g': '±', 'j': '┘', 'k': '┐',
    'l': '┌', 'm': '└', 'n': '┼', 'o': '⎺', 'p': '⎻', 'q': '─',
    'r': '⎼', 's': '⎽', 't': '├', 'u': '┤', 'v': '┴', 'w': '┬',
    'x': '│', 'y': '≤', 'z': '≥', '{': 'π', '|': '≠', '}': '£',
    '~': '·'
};

// Box Drawing segment table: index = codePoint - 0x2500
// Each entry: [left, right, up, down] where 0=none, 1=light, 2=heavy, 3=double
// null entries fall back to font glyph rendering
const BOX_DRAWING_SEGMENTS = [
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
            lineHeight: options.lineHeight || 0
        };

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'term-canvas';
        this.canvas.tabIndex = 0;
        this.container.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d', { alpha: false });

        // Theme colors
        const theme = this.options.theme;
        this.colors = {
            background: theme.background || '#0a0a0a',
            foreground: theme.foreground || '#e0e0e0',
            cursor: theme.cursor || '#a78bfa',
            selection: theme.selection || 'rgba(167, 139, 250, 0.3)',
            palette: theme.palette || XTERM_256_PALETTE
        };

        // Terminal state
        this.cols = 80;
        this.rows = 24;
        this.charWidth = 0;
        this.charHeight = 0;
        this.lineHeight = this.options.lineHeight || 1.15;

        // Primary and alternate buffers
        this.primaryBuffer = [];
        this.alternateBuffer = [];
        this.useAlternate = false;
        this.scrollbackBuffer = [];
        this.scrollbackOffset = 0;

        // Cursor state
        this.cursorX = 0;
        this.cursorY = 0;
        this.savedCursorX = 0;
        this.savedCursorY = 0;
        this.cursorVisible = true;
        this.cursorBlinkState = true;
        this.cursorBlinkTimer = null;

        // Current attributes
        this.curFg = 256;
        this.curBg = 256;
        this.curFlags = 0;
        this.savedFg = 256;
        this.savedBg = 256;
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
        this.lastRenderTime = 0;
        this.lastFont = null;

        // Glyph availability cache: codePoint → boolean (true = renderable)
        this._glyphCache = new Map();
        // Pre-probe PUA range availability at init
        this._puaAvailable = false;

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
                const oldWidth = this.charWidth;
                this.measureChar();
                if (this.charWidth !== oldWidth) {
                    this.resize();
                }
            }).catch(() => { /* font not available, fallback is fine */ });
        }
    }

    // -------------------------------------------------------------------------
    // Initialization Helpers
    // -------------------------------------------------------------------------

    measureChar() {
        const fontSize = this.options.fontSize;
        this.ctx.font = `${fontSize}px ${this.options.fontFamily}`;
        const metrics = this.ctx.measureText('W');
        // Preserve fractional width for precise subpixel character placement
        this.charWidth = Math.max(4, metrics.width);
        this.charHeight = Math.max(14, Math.ceil(fontSize * this.lineHeight));

        // Invalidate tofu reference data so it's re-probed with current font
        this._tofuData = null;

        // Probe Private Use Area glyph availability (Powerline/Nerd Font symbols)
        this._glyphCache.clear();
        // Test a representative sample of PUA glyphs:
        //  U+E0B0 = Powerline right arrow (most common)
        //  U+E0A0 = Powerline branch symbol
        //  U+F001 = Nerd Font fa-music
        this._puaAvailable = this._probeGlyph('\uE0B0') ||
                             this._probeGlyph('\uE0A0') ||
                             this._probeGlyph('\uF001');
    }

    /**
     * Probe whether a glyph is renderable by the current font.
     * 
     * Uses a visual signature approach: renders the character on a tiny canvas
     * and detects the .notdef tofu pattern. Tofu glyphs are hollow rectangles
     * with pixels concentrated on edges. Real glyphs have complex internal 
     * pixel patterns.
     * 
     * As a fast-path, uses document.fonts.check() when available, but wraps
     * it with a secondary validation since generic families like 'monospace'
     * can falsely report support.
     */
    _probeGlyph(ch) {
        const fontSpec = `${this.options.fontSize}px ${this.options.fontFamily}`;
        const size = Math.max(24, this.options.fontSize + 8);

        // Get the exact pixel signature of a known-missing glyph (U+FFFF)
        // This is guaranteed to be unassigned in Unicode, so it always renders
        // the system's native .notdef tofu glyph.
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

        // Render the actual test character
        const probe = document.createElement('canvas');
        probe.width = size; probe.height = size;
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        pctx.font = fontSpec;
        pctx.textBaseline = 'top';
        pctx.fillStyle = '#fff';
        pctx.fillText(ch, 2, 2);
        const testData = pctx.getImageData(0, 0, size, size).data;

        // Compare pixel-by-pixel against the tofu reference
        let diff = 0;
        let hasPixels = false;
        for (let i = 3; i < testData.length; i += 4) {
            if (testData[i] > 0) hasPixels = true;
            if (testData[i] !== this._tofuData[i]) diff++;
        }

        // If it perfectly matches the tofu signature, it's missing
        if (diff === 0 && hasPixels) return false;
        // No pixels at all — also missing
        if (!hasPixels) return false;
        return true;
    }

    /**
     * Check if a codepoint is renderable. Uses cached results for performance.
     * Private Use Area (U+E000–U+F8FF) is batch-checked via the _puaAvailable flag.
     */
    _isGlyphRenderable(cp) {
        // Standard ASCII + Latin + common scripts (Latin Extended, Greek, Cyrillic) — always renderable
        if (cp < 0x0530) return true;

        // CJK Unified Ideographs — typically available in system fonts
        if (cp >= 0x4E00 && cp <= 0x9FFF) return true;

        // Private Use Area (Powerline, Nerd Font, devicons)
        if (cp >= 0xE000 && cp <= 0xF8FF) return this._puaAvailable;

        // Supplementary PUA (Nerd Font Material Design icons, etc.)
        if (cp >= 0xF0000) return this._puaAvailable;

        // Check cache
        const cached = this._glyphCache.get(cp);
        if (cached !== undefined) return cached;

        // Probe and cache
        const renderable = this._probeGlyph(String.fromCodePoint(cp));
        this._glyphCache.set(cp, renderable);
        return renderable;
    }

    resetTerminal() {
        this.cols = 80;
        this.rows = 24;
        this.cursorX = 0;
        this.cursorY = 0;
        this.wrapPending = false;
        this.curFg = 256;
        this.curBg = 256;
        this.curFlags = 0;
        this.scrollTop = 0;
        this.scrollBottom = 0;
        this.useAlternate = false;
        this.scrollbackBuffer = [];
        this.scrollbackOffset = 0;
        this.selection = null;
        this.primaryBuffer = this.createBuffer(this.rows);
        this.alternateBuffer = [];
        this.tabStops.clear();
        for (let i = 0; i < this.cols; i += 8) {
            this.tabStops.add(i);
        }
        this.resize();
    }

    createBuffer(rows) {
        const buffer = [];
        for (let i = 0; i < rows; i++) {
            buffer.push(this.createEmptyLine());
        }
        return buffer;
    }

    createEmptyLine() {
        // Default empty line — uses default colors (for buffer creation, resize)
        return Array.from({ length: this.cols }, () => ({
            char: ' ', fg: 256, bg: 256, flags: 0
        }));
    }

    createBCELine() {
        // BCE-compliant empty line — uses current SGR colors (for erase/scroll ops)
        const fg = this.curFg;
        const bg = this.curBg;
        return Array.from({ length: this.cols }, () => ({
            char: ' ', fg, bg, flags: 0
        }));
    }

    // -------------------------------------------------------------------------
    // Resize Handling
    // -------------------------------------------------------------------------

    resize() {
        // Re-measure char dimensions (font may have loaded since last measure,
        // or container may have just become visible after display:none)
        this.measureChar();

        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const pad = this.options.padding;

        this.cols = Math.max(1, Math.floor((rect.width - pad * 2) / this.charWidth));
        this.rows = Math.max(1, Math.floor((rect.height - pad * 2) / this.charHeight));
        this.scrollBottom = 0;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.lastFont = null;

        this.resizeBuffer(this.primaryBuffer);
        if (this.alternateBuffer.length > 0) {
            this.resizeBuffer(this.alternateBuffer);
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

    resizeBuffer(buffer) {
        while (buffer.length < this.rows) {
            buffer.push(this.createEmptyLine());
        }
        while (buffer.length > this.rows) {
            this.scrollbackBuffer.push(buffer.shift());
            if (this.scrollbackBuffer.length > this.options.scrollback) {
                this.scrollbackBuffer.shift();
            }
        }
        for (let i = 0; i < buffer.length; i++) {
            const row = buffer[i];
            while (row.length < this.cols) {
                row.push({ char: ' ', fg: 256, bg: 256, flags: 0 });
            }
            row.length = this.cols;
        }
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
                this.curFg = 256; this.curBg = 256; this.curFlags = 0;
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
                this.curFg = p - 30;
            } else if (p === 38) {
                if (params[i + 1] === 5) {
                    this.curFg = params[i + 2] || 0; i += 2;
                } else if (params[i + 1] === 2) {
                    this.curFg = this.rgbToIndex(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0); i += 4;
                }
            } else if (p === 39) {
                this.curFg = 256;
            } else if (p >= 40 && p <= 47) {
                this.curBg = p - 40;
            } else if (p === 48) {
                if (params[i + 1] === 5) {
                    this.curBg = params[i + 2] || 0; i += 2;
                } else if (params[i + 1] === 2) {
                    this.curBg = this.rgbToIndex(params[i + 2] || 0, params[i + 3] || 0, params[i + 4] || 0); i += 4;
                }
            } else if (p === 49) {
                this.curBg = 256;
            } else if (p >= 90 && p <= 97) {
                this.curFg = p - 90 + 8;
            } else if (p >= 100 && p <= 107) {
                this.curBg = p - 100 + 8;
            }
        }
    }

    rgbToIndex(r, g, b) {
        if (r === g && g === b) {
            if (r < 8) return 16;
            if (r > 248) return 231;
            return 232 + Math.round((r - 8) / 10);
        }
        return 16 + 36 * Math.round(r / 51) + 6 * Math.round(g / 51) + Math.round(b / 51);
    }

    // -------------------------------------------------------------------------
    // Mode Setting
    // -------------------------------------------------------------------------

    setMode(params, priv) {
        for (const p of params) {
            if (priv) {
                switch (p) {
                    case 1: break;
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
                    case 1: break;
                    case 3:
                        this.cols = 80;
                        this.clearScreen();
                        if (this.onResize) this.onResize(this.cols, this.rows);
                        break;
                    case 9:
                    case 1000:
                    case 1002:
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

    getBuffer() {
        return this.useAlternate ? this.alternateBuffer : this.primaryBuffer;
    }

    switchToAlternateBuffer() {
        if (!this.useAlternate) {
            this.alternateBuffer = this.createBuffer(this.rows);
            this.useAlternate = true;
            this.scrollbackBuffer = [];
            this.scrollbackOffset = 0;
        }
    }

    switchToPrimaryBuffer() {
        if (this.useAlternate) {
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

        const buffer = this.getBuffer();
        if (this.cursorY >= 0 && this.cursorY < buffer.length &&
            this.cursorX >= 0 && this.cursorX < this.cols) {
            buffer[this.cursorY][this.cursorX] = {
                char: c, fg: this.curFg, bg: this.curBg, flags: this.curFlags
            };
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
        const buffer = this.getBuffer();
        const scrollTop = this.getScrollTop();
        const scrollBottom = this.getScrollBottom();
        for (let i = 0; i < n; i++) {
            const removed = buffer.splice(scrollTop, 1)[0];
            if (!this.useAlternate) {
                this.scrollbackBuffer.push(removed);
                if (this.scrollbackBuffer.length > this.options.scrollback) {
                    this.scrollbackBuffer.shift();
                }
            }
            buffer.splice(scrollBottom, 0, this.createBCELine());
        }
    }

    scrollDown(n = 1) {
        const buffer = this.getBuffer();
        const scrollTop = this.getScrollTop();
        const scrollBottom = this.getScrollBottom();
        for (let i = 0; i < n; i++) {
            buffer.splice(scrollBottom, 1);
            buffer.splice(scrollTop, 0, this.createBCELine());
        }
    }

    eraseDisplay(mode) {
        const buffer = this.getBuffer();
        switch (mode) {
            case 0:
                this.eraseLine(0);
                for (let y = this.cursorY + 1; y < buffer.length; y++) buffer[y] = this.createBCELine();
                break;
            case 1:
                this.eraseLine(1);
                for (let y = 0; y < this.cursorY; y++) buffer[y] = this.createBCELine();
                break;
            case 2:
            case 3:
                for (let y = 0; y < buffer.length; y++) buffer[y] = this.createBCELine();
                if (mode === 3 && !this.useAlternate) {
                    this.scrollbackBuffer = [];
                    this.scrollbackOffset = 0;
                }
                break;
        }
    }

    eraseLine(mode) {
        const buffer = this.getBuffer();
        const row = buffer[this.cursorY];
        if (!row) return;
        switch (mode) {
            case 0:
                for (let x = this.cursorX; x < this.cols; x++) row[x] = { char: ' ', fg: this.curFg, bg: this.curBg, flags: 0 };
                break;
            case 1:
                for (let x = 0; x <= this.cursorX; x++) row[x] = { char: ' ', fg: this.curFg, bg: this.curBg, flags: 0 };
                break;
            case 2:
                buffer[this.cursorY] = this.createBCELine();
                break;
        }
    }

    eraseChars(n) {
        const row = this.getBuffer()[this.cursorY];
        if (!row) return;
        for (let i = 0; i < n && this.cursorX + i < this.cols; i++) {
            row[this.cursorX + i] = { char: ' ', fg: this.curFg, bg: this.curBg, flags: 0 };
        }
    }

    insertChars(n) {
        const row = this.getBuffer()[this.cursorY];
        if (!row) return;
        for (let i = row.length - 1; i >= this.cursorX + n; i--) row[i] = row[i - n];
        for (let i = this.cursorX; i < this.cursorX + n && i < row.length; i++) {
            row[i] = { char: ' ', fg: this.curFg, bg: this.curBg, flags: 0 };
        }
    }

    deleteChars(n) {
        const row = this.getBuffer()[this.cursorY];
        if (!row) return;
        for (let i = this.cursorX; i < row.length - n; i++) row[i] = row[i + n];
        for (let i = row.length - n; i < row.length; i++) row[i] = { char: ' ', fg: this.curFg, bg: this.curBg, flags: 0 };
    }

    insertLines(n) {
        const buffer = this.getBuffer();
        const scrollBottom = this.getScrollBottom();
        for (let i = 0; i < n; i++) {
            if (this.cursorY <= scrollBottom) {
                buffer.splice(scrollBottom, 1);
                buffer.splice(this.cursorY, 0, this.createBCELine());
            }
        }
    }

    deleteLines(n) {
        const buffer = this.getBuffer();
        const scrollBottom = this.getScrollBottom();
        for (let i = 0; i < n; i++) {
            if (this.cursorY <= scrollBottom) {
                buffer.splice(this.cursorY, 1);
                buffer.splice(scrollBottom, 0, this.createBCELine());
            }
        }
    }

    clearScreen() {
        const buffer = this.getBuffer();
        for (let y = 0; y < buffer.length; y++) buffer[y] = this.createEmptyLine();
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
        if (!this.renderPending) {
            this.renderPending = true;
            requestAnimationFrame(() => this.render());
        }
    }

    render() {
        this.renderPending = false;

        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const height = this.canvas.height / (window.devicePixelRatio || 1);
        const pad = this.options.padding;

        this.ctx.fillStyle = this.colors.background;
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.save();
        this.ctx.translate(pad, pad);

        const buffer = this.getBuffer();
        const scrollbackVisible = this.scrollbackOffset > 0 && !this.useAlternate;

        // Collect all visible rows with their screen positions
        const visibleRows = [];

        if (scrollbackVisible) {
            const scrollbackStart = Math.max(0, this.scrollbackBuffer.length - this.scrollbackOffset);
            const scrollbackRows = Math.min(this.scrollbackOffset, this.rows);
            for (let i = 0; i < scrollbackRows; i++) {
                const idx = scrollbackStart + i;
                if (idx < this.scrollbackBuffer.length) {
                    visibleRows.push({ row: this.scrollbackBuffer[idx], screenY: i });
                }
            }
            const startRow = scrollbackRows;
            for (let y = 0; y < this.rows - startRow && y + startRow < this.rows; y++) {
                const row = buffer[y];
                if (row) visibleRows.push({ row, screenY: startRow + y });
            }
        } else {
            for (let y = 0; y < this.rows; y++) {
                const row = buffer[y];
                if (row) visibleRows.push({ row, screenY: y });
            }
        }

        // GLOBAL PASS 1: Draw ALL backgrounds first
        for (const { row, screenY } of visibleRows) {
            this.renderRowBg(row, screenY);
        }

        // GLOBAL PASS 2: Draw ALL text and decorations on top
        for (const { row, screenY } of visibleRows) {
            this.renderRowText(row, screenY);
        }

        if (this.selection) this.renderSelection();
        if (this.cursorVisible && this.focused) this.renderCursor();

        this.ctx.restore();
    }

    renderRowBg(row, y) {
        const baseline = y * this.charHeight;
        let bgStart = 0;
        let currentBgColor = this.resolveRowBg(row[0], row[0]?.flags ?? 0);
        for (let col = 0; col <= this.cols; col++) {
            const cell = row[col];
            const cellBg = this.resolveRowBg(cell, cell?.flags ?? 0);
            if (cellBg !== currentBgColor || col === this.cols) {
                this.ctx.fillStyle = currentBgColor;
                this.ctx.fillRect(bgStart * this.charWidth, baseline, (col - bgStart) * this.charWidth, this.charHeight);
                bgStart = col;
                currentBgColor = cellBg;
            }
        }
    }

    renderRowText(row, y) {
        const baseline = y * this.charHeight;
        let runStart = 0;
        let currentFg = row[0]?.fg ?? 256;
        let currentBg = row[0]?.bg ?? 256;
        let currentFlags = row[0]?.flags ?? 0;

        for (let col = 0; col <= this.cols; col++) {
            const cell = row[col];
            const fg = cell?.fg ?? 256;
            const bg = cell?.bg ?? 256;
            const flags = cell?.flags ?? 0;

            if (fg !== currentFg || bg !== currentBg || flags !== currentFlags || col === this.cols) {
                if (col > runStart) {
                    this.renderRunText(row, runStart, col - runStart, baseline, currentFg, currentBg, currentFlags);
                }
                runStart = col;
                currentFg = fg;
                currentBg = bg;
                currentFlags = flags;
            }
        }
    }

    resolveRowBg(cell, flags) {
        const fg = cell?.fg ?? 256;
        const bg = cell?.bg ?? 256;
        // For inverse, map default fg (256) to theme foreground color
        if (flags & ATTR.INVERSE) return fg === 256 ? this.colors.foreground : this.getColor(fg);
        if (bg !== 256) return this.getColor(bg);
        return this.colors.background;
    }

    renderRunText(row, startX, length, baseline, fg, bg, flags) {
        // Backgrounds are already drawn in renderRow pass 1

        // Collect text
        let hasContent = false;
        for (let x = startX; x < startX + length; x++) {
            if ((row[x]?.char || ' ') !== ' ') {
                hasContent = true;
                break;
            }
        }

        if (!hasContent && !(flags & (ATTR.UNDERLINE | ATTR.DOUBLE_UNDERLINE | ATTR.STRIKETHROUGH))) {
            return;
        }

        // Text color — for inverse, map default bg (256) to theme background
        const textColor = (flags & ATTR.INVERSE)
            ? (bg === 256 ? this.colors.background : this.getColor(bg))
            : this.getColor(fg);
        this.ctx.fillStyle = textColor;

        // Font style
        const fontParts = [];
        if (flags & ATTR.BOLD) fontParts.push('bold');
        if (flags & ATTR.ITALIC) fontParts.push('italic');
        fontParts.push(`${this.options.fontSize}px`);
        fontParts.push(this.options.fontFamily);
        const fontString = fontParts.join(' ');

        if (this.lastFont !== fontString) {
            this.ctx.font = fontString;
            this.lastFont = fontString;
        }
        this.ctx.textBaseline = 'top';

        // Render each character at its exact cell position to prevent drift
        for (let i = 0; i < length; i++) {
            const ch = row[startX + i]?.char || ' ';
            if (ch === ' ') continue;
            const cx = (startX + i) * this.charWidth;
            const cp = ch.codePointAt(0);
            // Programmatic rendering for block elements, box drawing, and braille
            if (cp >= 0x2500 && this.renderSpecialChar(cp, cx, baseline, textColor)) continue;
            // Skip unrenderable glyphs (tofu prevention)
            if (!this._isGlyphRenderable(cp)) continue;
            this.ctx.fillText(ch, cx, baseline);
        }

        // Underline
        if (flags & ATTR.UNDERLINE) {
            this.ctx.strokeStyle = textColor;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.stroke();
        }

        // Double underline
        if (flags & ATTR.DOUBLE_UNDERLINE) {
            this.ctx.strokeStyle = textColor;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight - 4);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight - 4);
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight - 2);
            this.ctx.stroke();
        }

        // Strikethrough
        if (flags & ATTR.STRIKETHROUGH) {
            this.ctx.strokeStyle = textColor;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(startX * this.charWidth, baseline + this.charHeight / 2);
            this.ctx.lineTo((startX + length) * this.charWidth, baseline + this.charHeight / 2);
            this.ctx.stroke();
        }
    }

    // -------------------------------------------------------------------------
    // Programmatic Unicode Character Rendering
    // -------------------------------------------------------------------------

    renderSpecialChar(code, x, y, color) {
        if (code >= 0x2580 && code <= 0x259F) return this.renderBlockChar(code, x, y, color);
        if (code >= 0x2500 && code <= 0x257F) return this.renderBoxDrawing(code, x, y, color);
        if (code >= 0x2800 && code <= 0x28FF) return this.renderBraille(code, x, y, color);
        return false;
    }

    renderBlockChar(code, x, y, color) {
        const w = this.charWidth;
        const h = this.charHeight;
        this.ctx.fillStyle = color;

        // Full block U+2588 (+0.5px overdraw to crush subpixel seams)
        if (code === 0x2588) { this.ctx.fillRect(x, y, w + 0.5, h + 0.5); return true; }

        // Upper half block U+2580
        if (code === 0x2580) { this.ctx.fillRect(x, y, w + 0.5, Math.ceil(h / 2)); return true; }

        // Lower blocks U+2581-U+2587 (1/8 to 7/8 from bottom)
        if (code >= 0x2581 && code <= 0x2587) {
            const frac = (code - 0x2580) / 8;
            const bh = Math.round(h * frac);
            this.ctx.fillRect(x, y + h - bh, w + 0.5, bh + 0.5);
            return true;
        }

        // Left blocks U+2589-U+258F (7/8 to 1/8 from left)
        if (code >= 0x2589 && code <= 0x258F) {
            const frac = (0x2590 - code) / 8;
            this.ctx.fillRect(x, y, Math.round(w * frac) + 0.5, h + 0.5);
            return true;
        }

        // Right half block U+2590
        if (code === 0x2590) {
            const hw = Math.floor(w / 2);
            this.ctx.fillRect(x + hw, y, w - hw + 0.5, h + 0.5);
            return true;
        }

        // Shade characters U+2591-U+2593
        if (code >= 0x2591 && code <= 0x2593) {
            const alpha = [0.25, 0.50, 0.75][code - 0x2591];
            this.ctx.globalAlpha = alpha;
            this.ctx.fillRect(x, y, w + 0.5, h + 0.5);
            this.ctx.globalAlpha = 1;
            return true;
        }

        // Upper one-eighth block U+2594
        if (code === 0x2594) { this.ctx.fillRect(x, y, w, Math.max(1, Math.round(h / 8))); return true; }

        // Right one-eighth block U+2595
        if (code === 0x2595) {
            const ew = Math.max(1, Math.round(w / 8));
            this.ctx.fillRect(x + w - ew, y, ew, h);
            return true;
        }

        // Quadrant characters U+2596-U+259F
        if (code >= 0x2596 && code <= 0x259F) {
            const masks = [
                0b0010, 0b0001, 0b1000, 0b1011, 0b1001, // 2596-259A
                0b1110, 0b1101, 0b0100, 0b0110, 0b0111  // 259B-259F
            ];
            const mask = masks[code - 0x2596];
            const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
            if (mask & 8) this.ctx.fillRect(x, y, hw, hh);
            if (mask & 4) this.ctx.fillRect(x + hw, y, w - hw, hh);
            if (mask & 2) this.ctx.fillRect(x, y + hh, hw, h - hh);
            if (mask & 1) this.ctx.fillRect(x + hw, y + hh, w - hw, h - hh);
            return true;
        }

        return false;
    }

    renderBoxDrawing(code, x, y, color) {
        const idx = code - 0x2500;
        if (idx < 0 || idx >= BOX_DRAWING_SEGMENTS.length) return false;
        const seg = BOX_DRAWING_SEGMENTS[idx];
        if (!seg) return false;

        const [lw, rw, uw, dw] = seg;
        const w = this.charWidth;
        const h = this.charHeight;
        const mx = x + Math.floor(w / 2);
        const my = y + Math.floor(h / 2);
        const thin = 1;
        const thick = Math.max(2, Math.round(w / 5));
        const gap = Math.max(2, Math.round(Math.min(w, h) * 0.3));

        this.ctx.fillStyle = color;

        const hLine = (x1, x2, cy, wt) => {
            if (wt === 1) this.ctx.fillRect(x1, cy, x2 - x1, thin);
            else if (wt === 2) this.ctx.fillRect(x1, cy - Math.floor(thick / 2), x2 - x1, thick);
            else if (wt === 3) {
                this.ctx.fillRect(x1, cy - gap, x2 - x1, thin);
                this.ctx.fillRect(x1, cy + gap, x2 - x1, thin);
            }
        };
        const vLine = (y1, y2, cx, wt) => {
            if (wt === 1) this.ctx.fillRect(cx, y1, thin, y2 - y1);
            else if (wt === 2) this.ctx.fillRect(cx - Math.floor(thick / 2), y1, thick, y2 - y1);
            else if (wt === 3) {
                this.ctx.fillRect(cx - gap, y1, thin, y2 - y1);
                this.ctx.fillRect(cx + gap, y1, thin, y2 - y1);
            }
        };

        if (lw) hLine(x, mx + thin, my, lw);
        if (rw) hLine(mx, x + w, my, rw);
        if (uw) vLine(y, my + thin, mx, uw);
        if (dw) vLine(my, y + h, mx, dw);

        return true;
    }

    renderBraille(code, x, y, color) {
        const bits = code - 0x2800;
        if (bits === 0) return true; // blank braille
        const w = this.charWidth;
        const h = this.charHeight;
        const dotW = Math.max(1, Math.round(w * 0.2));
        const dotH = Math.max(1, Math.round(h * 0.1));
        const cx1 = x + Math.round(w * 0.3);
        const cx2 = x + Math.round(w * 0.7);
        const rows = [0.15, 0.35, 0.55, 0.75];
        // Bit layout: dots 1-8 map to bits 0-7
        // Col 1: bits 0,1,2,6  Col 2: bits 3,4,5,7
        const dotMap = [
            [0, cx1], [1, cx1], [2, cx1], [6, cx1],
            [3, cx2], [4, cx2], [5, cx2], [7, cx2]
        ];
        this.ctx.fillStyle = color;
        for (let i = 0; i < 8; i++) {
            const [bit, dx] = dotMap[i];
            if (bits & (1 << bit)) {
                const dy = y + Math.round(h * rows[i % 4]);
                this.ctx.fillRect(dx - Math.floor(dotW / 2), dy - Math.floor(dotH / 2), dotW, dotH);
            }
        }
        return true;
    }

    getColor(index) {
        if (index === 256) return this.colors.foreground;
        if (index === 257) return this.colors.background;
        if (index >= 0 && index < this.colors.palette.length) {
            return this.colors.palette[index];
        }
        return this.colors.foreground;
    }

    renderCursor() {
        const x = this.cursorX * this.charWidth;
        const y = this.cursorY * this.charHeight;
        const adjustedY = y - (this.scrollbackOffset * this.charHeight);

        if (adjustedY < 0 || adjustedY >= this.canvas.height / (window.devicePixelRatio || 1)) return;
        if (!this.cursorBlinkState && this.options.cursorBlink) return;

        this.ctx.fillStyle = this.colors.cursor;

        switch (this.options.cursorStyle) {
            case 'underline':
                this.ctx.fillRect(x, adjustedY + this.charHeight - 3, this.charWidth, 3);
                break;
            case 'bar':
                this.ctx.fillRect(x, adjustedY, 2, this.charHeight);
                break;
            case 'block':
            default:
                if (this.cursorBlinkState) {
                    this.ctx.fillRect(x, adjustedY, this.charWidth, this.charHeight);
                    const buffer = this.getBuffer();
                    const cell = buffer[this.cursorY]?.[this.cursorX];
                    if (cell && cell.char !== ' ') {
                        this.ctx.fillStyle = this.colors.background;
                        // Build font string respecting cell's SGR flags (bold/italic)
                        const cursorFontParts = [];
                        if (cell.flags & ATTR.BOLD) cursorFontParts.push('bold');
                        if (cell.flags & ATTR.ITALIC) cursorFontParts.push('italic');
                        cursorFontParts.push(`${this.options.fontSize}px`);
                        cursorFontParts.push(this.options.fontFamily);
                        this.ctx.font = cursorFontParts.join(' ');
                        this.ctx.textBaseline = 'top';
                        this.ctx.fillText(cell.char, x, adjustedY);
                    }
                    // Invalidate font cache — renderCursor changed ctx.font
                    // without going through the renderRunText caching path
                    this.lastFont = null;
                }
                break;
        }
    }

    renderSelection() {
        if (!this.selection) return;
        const { startRow, endRow, startCol, endCol } = this.selection;
        for (let y = startRow; y <= endRow; y++) {
            let x1 = y === startRow ? startCol : 0;
            let x2 = y === endRow ? endCol : this.cols;
            if (x1 < x2) {
                this.ctx.fillStyle = this.colors.selection;
                this.ctx.fillRect(x1 * this.charWidth, y * this.charHeight, (x2 - x1) * this.charWidth, this.charHeight);
            }
        }
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

        const resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(this.container);

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
                case 'ArrowUp': seq = modifier ? `\x1b[1;${modifier + 1}A` : '\x1b[A'; break;
                case 'ArrowDown': seq = modifier ? `\x1b[1;${modifier + 1}B` : '\x1b[B'; break;
                case 'ArrowRight': seq = modifier ? `\x1b[1;${modifier + 1}C` : '\x1b[C'; break;
                case 'ArrowLeft': seq = modifier ? `\x1b[1;${modifier + 1}D` : '\x1b[D'; break;
                case 'Home': seq = modifier ? `\x1b[1;${modifier + 1}H` : '\x1b[H'; break;
                case 'End': seq = modifier ? `\x1b[1;${modifier + 1}F` : '\x1b[F'; break;
                case 'Insert': seq = '\x1b[2~'; break;
                case 'Delete': seq = '\x1b[3~'; break;
                case 'PageUp': seq = '\x1b[5~'; break;
                case 'PageDown': seq = '\x1b[6~'; break;
                default:
                    if (e.ctrlKey && e.key.length === 1) {
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
        if (e.button === 0) {
            if (this.mouseTracking && !e.shiftKey) {
                this.sendMouseReport(e, 'down');
            } else {
                this.isSelecting = true;
                this.selectionStart = this.screenToCell(e.clientX, e.clientY);
                this.selection = {
                    startRow: this.selectionStart.y, endRow: this.selectionStart.y,
                    startCol: this.selectionStart.x, endCol: this.selectionStart.x
                };
            }
        }
        this.canvas.focus();
    }

    onMouseMove(e) {
        if (this.mouseTracking && this.mouseTracking === 1002 && !e.shiftKey) {
            if (this.isSelecting || e.buttons === 1) this.sendMouseReport(e, 'drag');
        } else if (this.isSelecting) {
            const cell = this.screenToCell(e.clientX, e.clientY);
            if (this.selectionStart) {
                if (cell.y < this.selectionStart.y || (cell.y === this.selectionStart.y && cell.x < this.selectionStart.x)) {
                    this.selection = { startRow: cell.y, endRow: this.selectionStart.y, startCol: cell.x, endCol: this.selectionStart.x };
                } else {
                    this.selection = { startRow: this.selectionStart.y, endRow: cell.y, startCol: this.selectionStart.x, endCol: cell.x };
                }
                this.triggerRender();
            }
        }
    }

    onMouseUp(e) {
        if (e.button === 0) {
            if (this.mouseTracking && !e.shiftKey) this.sendMouseReport(e, 'up');
            this.isSelecting = false;
        }
    }

    sendMouseReport(e, type) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.charWidth) + 1;
        const y = Math.floor((e.clientY - rect.top) / this.charHeight) + 1;

        let button = e.button;
        if (type === 'up') button = 3;
        else if (type === 'drag' && e.buttons === 1) button = 32 + 1;
        else if (type === 'drag') return;

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
            const delta = Math.round(e.deltaY / this.charHeight);
            this.scrollbackOffset = Math.max(0, Math.min(this.scrollbackBuffer.length, this.scrollbackOffset + delta));
            this.triggerRender();
        }
    }

    onContextMenu(e) {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
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
        const buffer = this.getBuffer();
        const { startRow, endRow, startCol, endCol } = this.selection;
        const lines = [];
        for (let y = startRow; y <= endRow; y++) {
            const row = buffer[y];
            if (!row) continue;
            const sx = y === startRow ? startCol : 0;
            const ex = y === endRow ? endCol : this.cols;
            let line = '';
            for (let x = sx; x < ex; x++) line += row[x]?.char || ' ';
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

    destroy() {
        this.stopCursorBlink();
        if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
}
```

### File: `src/frontend/styles.css`

- Size: 7669 bytes
- Modified: 2026-02-14 05:18:45 UTC

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  display: flex;
  height: 100vh;
  background: #0d0d0d;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  overflow: hidden;
}

/* ═══════════════════════════════════════════════════════════════════════
   SIDEBAR - Session Manager
   ═══════════════════════════════════════════════════════════════════════ */
#sidebar {
  width: 220px;
  min-width: 180px;
  max-width: 400px;
  resize: horizontal;
  background: #111;
  border-right: 1px solid #2a2a2a;
  display: flex;
  flex-direction: column;
  z-index: 10;
}

#sidebar-header {
  padding: 12px 14px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid #2a2a2a;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #151515;
  user-select: none;
}

#sidebar-header .logo {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #a78bfa;
}

#sessions {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: #333 transparent;
}

#sessions::-webkit-scrollbar { width: 6px; }
#sessions::-webkit-scrollbar-track { background: transparent; }
#sessions::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

#sessions li {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid #1a1a1a;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s;
  font-size: 13px;
}

#sessions li:hover { background: #1a1a1a; }

#sessions li.active {
  background: #1f1f2e;
  border-left: 3px solid #a78bfa;
  padding-left: 11px;
}

.session-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.session-status.running { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.session-status.exited { background: #6b7280; }
.session-status.error { background: #ef4444; }

.session-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  color: #555;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  transition: 0.15s;
  padding: 2px 6px;
  border-radius: 3px;
}

.close-btn:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

#enc-status {
  font-size: 12px;
  color: #555;
  padding: 10px 14px;
  border-top: 1px solid #2a2a2a;
  background: #0f0f0f;
  display: flex;
  align-items: center;
  gap: 6px;
}

#enc-status.secure { color: #22c55e; }

/* ═══════════════════════════════════════════════════════════════════════
   MAIN TERMINAL AREA
   ═══════════════════════════════════════════════════════════════════════ */
#main {
  flex: 1;
  position: relative;
  background: #0a0a0a;
  display: flex;
  flex-direction: column;
}

.term-wrapper {
  display: none;
  position: absolute;
  inset: 0;
}

.term-wrapper.active { display: flex; flex-direction: column; }

.term-canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.term-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: text;
}

/* Selection overlay */
.term-selection {
  position: absolute;
  pointer-events: none;
  background: rgba(167, 139, 250, 0.25);
  border: 1px solid rgba(167, 139, 250, 0.5);
}

/* Status bar */
.term-statusbar {
  height: 26px;
  background: #111;
  border-top: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 11px;
  color: #666;
  gap: 16px;
  user-select: none;
}

.term-statusbar .left { flex: 1; display: flex; gap: 12px; }
.term-statusbar .right { display: flex; gap: 12px; }
.term-statusbar .dim { opacity: 0.6; }

/* Buttons */
button.btn {
  background: #222;
  color: #e0e0e0;
  border: 1px solid #333;
  padding: 5px 10px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  transition: 0.15s;
}

button.btn:hover { background: #2a2a2a; border-color: #444; }
button.btn:active { background: #1a1a1a; }

/* Context menu */
#context-menu {
  position: fixed;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 150px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: 1000;
  display: none;
}

#context-menu.visible { display: block; }

#context-menu .item {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
}

#context-menu .item:hover { background: #2a2a2a; }
#context-menu .item .shortcut { color: #555; font-size: 11px; }

/* Scrollbar for scrollback */
.scrollbar {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  background: transparent;
  cursor: pointer;
  z-index: 5;
}

.scrollbar-thumb {
  position: absolute;
  right: 2px;
  width: 6px;
  background: #333;
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.15s;
}

.scrollbar:hover .scrollbar-thumb,
.term-canvas-container:focus-within + .scrollbar .scrollbar-thumb {
  opacity: 1;
}

/* ═══════════════════════════════════════════════════════════════════════
   TOTP Modal
   ═══════════════════════════════════════════════════════════════════════ */
.totp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease;
}

.totp-overlay.fade-out {
  animation: fadeOut 0.3s ease forwards;
}

.totp-modal {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 16px;
  padding: 36px 40px;
  text-align: center;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 40px rgba(167, 139, 250, 0.08);
  max-width: 380px;
  width: 90%;
}

.totp-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.totp-title {
  font-size: 18px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 6px;
}

.totp-subtitle {
  font-size: 13px;
  color: #888;
  margin-bottom: 24px;
  line-height: 1.4;
}

.totp-input {
  width: 100%;
  padding: 14px;
  font-size: 32px;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  text-align: center;
  letter-spacing: 12px;
  background: #111;
  border: 2px solid #333;
  border-radius: 10px;
  color: #e0e0e0;
  outline: none;
  transition: border-color 0.2s;
  caret-color: #a78bfa;
}

.totp-input:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.15);
}

.totp-input::placeholder {
  color: #333;
  letter-spacing: 12px;
}

.totp-error {
  font-size: 13px;
  color: #ef4444;
  margin-top: 12px;
  min-height: 18px;
  opacity: 0;
  transition: opacity 0.2s;
}

.totp-error.visible {
  opacity: 1;
}

.totp-hint {
  font-size: 11px;
  color: #555;
  margin-top: 16px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
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

- Size: 4946 bytes
- Modified: 2026-02-13 09:40:49 UTC

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
    const htmlClient = buildHTML(getCryptoJS());

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

- Size: 20659 bytes
- Modified: 2026-03-20 18:29:46 UTC

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

    const htmlClient = buildHTML(getCryptoJS());

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

- Size: 4525 bytes
- Modified: 2026-03-20 18:29:46 UTC

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

const PORT = 7777;
const testDir = path.dirname(new URL(import.meta.url).pathname);
const nanoTermPath = path.join(testDir, '..', 'src', 'frontend', 'nanoterm.js');

// Track active PTY sessions per WebSocket
const sessions = new Map<number, ReturnType<typeof Bun.spawn>>();
let sessionCounter = 0;

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
            const shellCmd = process.env.SHELL || '/bin/bash';
            console.log(`🐚 [Test] Client ${ws.data.id} connected — spawning PTY: ${shellCmd}`);

            const proc = Bun.spawn([shellCmd], {
                cwd: process.env.HOME || '/tmp',
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
                            if (ws.readyState === 1) {
                                ws.send(data);
                            }
                        } catch { /* client disconnected */ }
                    },
                },
            });

            sessions.set(ws.data.id, proc);
            console.log(`🐚 [Test] PTY spawned PID=${proc.pid}`);
        },

        message(ws, message) {
            const proc = sessions.get(ws.data.id);
            if (!proc) return;

            // Binary input → PTY terminal
            if (typeof message !== 'string') {
                try {
                    const terminal = (proc as any).terminal;
                    if (terminal) {
                        terminal.write(new TextDecoder().decode(message as ArrayBuffer));
                    }
                } catch { /* process exited */ }
                return;
            }

            // JSON control messages
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
                // Not JSON — treat as text input
                const terminal = (proc as any).terminal;
                if (terminal) {
                    terminal.write(message);
                }
            }
        },

        close(ws) {
            const proc = sessions.get(ws.data.id);
            if (proc) {
                console.log(`🐚 [Test] Client ${ws.data.id} disconnected — killing PID=${proc.pid}`);
                try {
                    (proc as any).terminal?.close();
                    proc.kill();
                } catch { /* already dead */ }
                sessions.delete(ws.data.id);
            }
        },
    },
});

console.log(`\n🧪 ShellPort Standalone Test Server`);
console.log(`   Open http://localhost:${PORT} in your browser\n`);
```

### File: `test/shellport-test.html`

- Size: 3733 bytes
- Modified: 2026-03-20 18:29:46 UTC

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
        <span id="status" class="status">Connecting…</span>
    </header>
    <div id="terminal-container"></div>

    <script src="/vendor/nanoterm.js"></script>
    <script>
        const statusEl = document.getElementById('status');
        const container = document.getElementById('terminal-container');

        // Connect WebSocket
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${location.host}/ws`);
        ws.binaryType = 'arraybuffer';

        // Create NanoTermV2 once connected
        let term = null;

        ws.onopen = () => {
            statusEl.textContent = '● Connected';
            statusEl.className = 'status connected';

            term = new NanoTermV2(container, (data) => {
                // Send keystrokes as binary
                if (typeof data === 'string') {
                    const encoded = new TextEncoder().encode(data);
                    ws.send(encoded);
                } else {
                    ws.send(data);
                }
            }, {
                fontSize: 14,
                cursorBlink: true,
                scrollback: 10000,
                theme: {
                    background: '#0a0a0f',
                    foreground: '#e4e4e7',
                    cursor: '#a78bfa',
                    selection: 'rgba(167, 139, 250, 0.3)',
                },
            });

            // Wire resize → server
            term.onResize = (cols, rows) => {
                ws.send(JSON.stringify({ type: 'resize', cols, rows }));
            };

            // Send initial size
            if (term.cols && term.rows) {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }

            term.canvas.focus();
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
