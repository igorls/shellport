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
                console.log(`🐚 [Test] Client ${ws.data.id} connected — spawning shell (piped): ${shellCmd}`);

                const proc = Bun.spawn([shellCmd], {
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
                // Piped mode (Windows)
                if (typeof message !== 'string') {
                    try {
                        proc.stdin?.write(new TextDecoder().decode(message as ArrayBuffer));
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
                // Write text input to stdin
                try {
                    proc.stdin?.write(message);
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
