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
        // Support both string data and raw Uint8Array (e.g., legacy X10 mouse reports)
        const payload = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        sendMsg(0, payload);
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