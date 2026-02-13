// ═══════════════════════════════════════════════════════════════════════════
// ShellPort - Session Manager & UI Logic
// ═══════════════════════════════════════════════════════════════════════════

let cryptoKey = null;
let sessionCount = 0;
const activeSessions = new Map();
let currentSessionId = null;

const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';

async function init() {
    const secret = location.hash.substring(1);
    cryptoKey = await deriveKey(secret);

    const status = document.getElementById('enc-status');
    if (cryptoKey) {
        status.innerHTML = '🔒 AES-256-GCM';
        status.classList.add('secure');
        history.replaceState(null, '', location.pathname);
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

    // Create sidebar item
    const li = document.createElement('li');
    li.innerHTML = `
    <span class="session-status running"></span>
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
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    const sendQ = new SeqQueue();
    const recvQ = new SeqQueue();

    const sendMsg = (type, payload) => sendQ.add(async () => {
        if (ws.readyState === 1) ws.send(await pack(cryptoKey, type, payload));
    });

    // Create terminal
    const term = new NanoTermV2(canvasContainer, data => {
        const encoder = new TextEncoder();
        sendMsg(0, encoder.encode(data));
    });

    term.onResize = (cols, rows) => {
        sendMsg(1, new TextEncoder().encode(JSON.stringify({ type: 'resize', cols, rows })));
        updateStatusBar(id);
    };

    term.onTitle = title => {
        const label = li.querySelector('.session-label');
        if (label) label.textContent = title.slice(0, 30);
    };

    ws.onopen = () => {
        term.resize();
        term.canvas.focus();
    };

    ws.onmessage = e => recvQ.add(async () => {
        const decoded = await unpack(cryptoKey, e.data);
        if (decoded && decoded.type === 0) {
            term.write(decoded.payload);
        }
    });

    ws.onclose = () => {
        const statusEl = li.querySelector('.session-status');
        if (statusEl) {
            statusEl.classList.remove('running');
            statusEl.classList.add('exited');
        }
        term.write('\r\n[Disconnected]\r\n');
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

init();
